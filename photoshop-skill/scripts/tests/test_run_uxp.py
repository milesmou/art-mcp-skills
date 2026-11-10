"""Tests for result identity, recovery, run locking and script warning configuration."""

import codecs
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

script = Path(__file__).resolve().parents[1] / "run_uxp.py"
spec = importlib.util.spec_from_file_location("run_uxp", script)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.lock_patch = patch.object(runner, "RUNS_ROOT", self.root / "locks")
        self.lock_patch.start()
        self.addCleanup(self.lock_patch.stop)

    def metadata(self, run_id="uxp_test"):
        run_dir = self.root / "run"
        run_dir.mkdir(exist_ok=True)
        return {"run_id": run_id, "run_dir": str(run_dir), "search_roots": [str(self.root / "host")]}

    def host_result(self, state):
        path = self.root / "host" / "PluginsStorage/PHSP/24/External/10001/PluginData/uxp_test/state.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state), encoding="utf-8")
        return path

    def test_only_terminal_result_with_matching_run_id_is_collected(self):
        meta = self.metadata()
        path = self.host_result({"run_id": "old_run", "status": "completed"})
        self.assertIsNone(runner.collect(Path(meta["run_dir"]), meta))
        path.write_text('{"run_id": "uxp_test", "status": "running"}', encoding="utf-8")
        self.assertIsNone(runner.collect(Path(meta["run_dir"]), meta))
        path.write_text('{"run_id":', encoding="utf-8")
        self.assertIsNone(runner.collect(Path(meta["run_dir"]), meta))

    def test_failure_result_and_artifacts_are_preserved(self):
        meta = self.metadata()
        runner.acquire_lock(meta)
        path = self.host_result({"run_id": "uxp_test", "status": "failed", "errors": [{"message": "test"}]})
        (path.parent / "partial.png").write_bytes(b"partial output")
        result, code = runner.wait_for_result(Path(meta["run_dir"]), meta, 0)
        self.assertEqual(code, 1)
        self.assertEqual(result["errors"][0]["message"], "test")
        self.assertTrue((Path(result["output_dir"]) / "partial.png").is_file())
        self.assertFalse(runner.active_lock().exists())

    def test_timeout_keeps_lock_and_blocks_next_launch(self):
        meta = self.metadata()
        runner.acquire_lock(meta)
        result, code = runner.wait_for_result(Path(meta["run_dir"]), meta, 0)
        self.assertEqual(code, 124)
        self.assertEqual(result["status"], "timeout")
        self.assertTrue(runner.active_lock().exists())
        with self.assertRaisesRegex(RuntimeError, "prior UXP task"):
            runner.acquire_lock({**meta, "run_id": "second_run"})

    def test_finished_previous_run_is_collected_before_next_lock(self):
        meta = self.metadata()
        runner.acquire_lock(meta)
        self.host_result({"run_id": "uxp_test", "status": "completed", "errors": []})
        runner.acquire_lock({**meta, "run_id": "next_run"})
        self.assertEqual(json.loads(runner.active_lock().read_text())["run_id"], "next_run")
        self.assertTrue((Path(meta["run_dir"]) / "output/state.json").is_file())

    def test_build_preserves_unicode_and_literal_markers_in_body(self):
        body = 'const name = "游戏素材"; // /*__TASK_BODY__*/'
        built = runner.build_script(body, "uxp_test")
        self.assertIn(body, built)
        self.assertIn('"run_id": "uxp_test"', built)
        self.assertNotIn("/*__RUN_CONFIG__*/", built)

    def test_invalid_run_id_cannot_escape_run_folder(self):
        with self.assertRaises(ValueError):
            runner.build_script("", "../another-folder")


class ScriptWarningTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.settings = self.root / "settings"
        self.settings.mkdir()
        self.config = self.settings / "PSUserConfig.txt"

    def test_settings_location_matches_target_version(self):
        photoshop = self.root / "Adobe Photoshop 2023" / "Photoshop.exe"
        with patch.object(runner.sys, "platform", "win32"), \
                patch.dict(runner.os.environ, {"APPDATA": str(self.root)}):
            self.assertEqual(runner.photoshop_settings_dir(photoshop),
                             self.root / "Adobe" / "Adobe Photoshop 2023" /
                             "Adobe Photoshop 2023 Settings")
        with patch.object(runner.sys, "platform", "darwin"), \
                patch.object(runner.Path, "home", return_value=self.root):
            self.assertEqual(runner.photoshop_settings_dir(self.root / "Adobe Photoshop 2025.app"),
                             self.root / "Library" / "Preferences" / "Adobe Photoshop 2025 Settings")

    def test_renamed_installation_needs_explicit_settings_directory(self):
        with patch.object(runner.sys, "platform", "win32"):
            with self.assertRaisesRegex(RuntimeError, "--settings-dir"):
                runner.photoshop_settings_dir(self.root / "Renamed" / "Photoshop.exe")

    def test_new_configuration_is_created_and_second_call_does_not_write(self):
        self.assertTrue(runner.disable_script_warning(self.settings))
        self.assertEqual(self.config.read_bytes(), b"WarnRunningScripts 0\n")
        modified = self.config.stat().st_mtime_ns
        self.assertFalse(runner.disable_script_warning(self.settings))
        self.assertEqual(self.config.stat().st_mtime_ns, modified)
        self.assertFalse(self.config.with_suffix(".txt.bak").exists())

    def test_other_settings_comments_encoding_and_backup_are_preserved(self):
        before = ("# WarnRunningScripts 1\r\n# 中文备注\r\nUseSystemStylus 0\r\n"
                  "WarnRunningScripts\t1 # keep comment\r\nWarnRunningScripts 0\r\n")
        after = before.replace("WarnRunningScripts\t1", "WarnRunningScripts\t0")
        for encoding in ("utf-8", "utf-8-sig", "utf-16", "utf-16-be", "gbk"):
            with self.subTest(encoding=encoding):
                backup = self.config.with_suffix(".txt.bak")
                backup.unlink(missing_ok=True)
                bom = codecs.BOM_UTF16_BE if encoding == "utf-16-be" else b""
                original = bom + before.encode(encoding)
                self.config.write_bytes(original)
                self.assertTrue(runner.disable_script_warning(self.settings))
                self.assertEqual(self.config.read_bytes(), bom + after.encode(encoding))
                self.assertEqual(backup.read_bytes(), original)
                self.assertFalse(runner.disable_script_warning(self.settings))
                self.assertEqual(backup.read_bytes(), original)

    def test_missing_directive_is_added_after_unterminated_last_line(self):
        self.config.write_bytes(b"UseSystemStylus 0\r\nGPUDeny 0")
        self.assertTrue(runner.disable_script_warning(self.settings))
        self.assertEqual(self.config.read_bytes(),
                         b"UseSystemStylus 0\r\nGPUDeny 0\r\nWarnRunningScripts 0\r\n")

    def test_failed_replace_preserves_original_and_removes_temporary_file(self):
        original = b"WarnRunningScripts 1\n"
        self.config.write_bytes(original)
        with patch.object(runner.Path, "replace", side_effect=OSError("replace failed")):
            with self.assertRaisesRegex(OSError, "replace failed"):
                runner.disable_script_warning(self.settings)
        self.assertEqual(self.config.read_bytes(), original)
        self.assertEqual(self.config.with_suffix(".txt.bak").read_bytes(), original)
        self.assertEqual(list(self.settings.glob("*.tmp")), [])

    def run_task(self, *options, is_running=True):
        task = self.root / "body.psjs"
        task.write_text("runExtra = {};", encoding="utf-8")
        photoshop = self.root / "Photoshop.exe"
        photoshop.touch()
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(runner, "RUNS_ROOT", self.root / "runs"), \
                patch.object(runner, "default_search_roots", return_value=[]), \
                patch.object(runner, "launch") as launch, \
                patch.object(runner, "photoshop_is_running", return_value=is_running) as running, \
                patch.object(runner, "wait_for_result", return_value=({"status": "completed"}, 0)), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = runner.main([str(task), "--photoshop", str(photoshop),
                                "--settings-dir", str(self.settings), *options])
        return code, output.getvalue(), errors.getvalue(), launch, running

    def test_default_entry_point_configures_and_notifies_on_actual_change(self):
        code, _, errors, launch, running = self.run_task()
        self.assertEqual(code, 0)
        self.assertEqual(self.config.read_bytes(), b"WarnRunningScripts 0\n")
        self.assertIn("Restart Photoshop", errors)
        launch.assert_called_once()
        running.assert_called_once()

    def test_cold_start_applies_new_configuration_without_restart_notice(self):
        code, _, errors, launch, running = self.run_task(is_running=False)
        self.assertEqual(code, 0)
        self.assertEqual(errors, "")
        self.assertEqual(self.config.read_bytes(), b"WarnRunningScripts 0\n")
        launch.assert_called_once()
        running.assert_called_once()

    def test_already_configured_entry_point_has_no_restart_notice(self):
        self.config.write_bytes(b"WarnRunningScripts 0\r\n")
        modified = self.config.stat().st_mtime_ns
        code, _, errors, launch, running = self.run_task()
        self.assertEqual(code, 0)
        self.assertEqual(errors, "")
        self.assertEqual(self.config.stat().st_mtime_ns, modified)
        launch.assert_called_once()
        running.assert_not_called()

    def test_prepare_only_and_explicit_opt_out_preserve_configuration(self):
        original = b"WarnRunningScripts 1\n"
        for option in ("--prepare-only", "--keep-script-warning"):
            with self.subTest(option=option):
                self.config.write_bytes(original)
                code, _, errors, launch, running = self.run_task(option)
                self.assertEqual(code, 0)
                self.assertEqual(errors, "")
                self.assertEqual(self.config.read_bytes(), original)
                self.assertFalse(self.config.with_suffix(".txt.bak").exists())
                self.assertEqual(launch.call_count, int(option == "--keep-script-warning"))
                running.assert_not_called()


if __name__ == "__main__":
    unittest.main()

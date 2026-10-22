"""Tests for result identity, recovery and protection against overlapping runs."""

import importlib.util
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


if __name__ == "__main__":
    unittest.main()

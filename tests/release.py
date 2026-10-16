"""Execute release boundary programs with disposable Git and provider-I/O fixtures."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleaseBoundaries(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cwd = Path(self.tmp.name)
        self.env = dict(os.environ, PATH=f"{self.cwd}:{os.environ['PATH']}",
                        GITHUB_REPOSITORY="fixture/parlor", GATE_RESULT="success",
                        RELEASE_PR='{"number": 7, "headBranchName": "release-please--branches--master--components--parlor"}',
                        GITHUB_OUTPUT=str(self.cwd / "output"),
                        GIT_AUTHOR_NAME="Fixture", GIT_COMMITTER_NAME="Fixture",
                        GIT_AUTHOR_EMAIL="fixture@example.invalid", GIT_COMMITTER_EMAIL="fixture@example.invalid")
        self.run_command(["git", "init", "--quiet"])
        self.run_command(["git", "commit", "--quiet", "--allow-empty", "-m", "baseline"])
        self.sha = self.run_command(["git", "rev-parse", "HEAD"]).stdout.strip()
        self.env.update(GITHUB_SHA=self.sha, FIXTURE_SHA=self.sha, FIXTURE_LIVE=self.sha)
        self.write_config(self.sha)
        self.pr = {"state": "open", "base": {"ref": "master"},
                   "head": {"sha": self.sha, "ref": json.loads(self.env["RELEASE_PR"])["headBranchName"],
                            "repo": {"full_name": "fixture/parlor"}},
                   "user": {"login": "github-actions[bot]"}}
        gh = self.cwd / "gh"
        gh.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = " ".join(sys.argv)
root = Path(__file__).parent
if "git/ref/heads/master" in args:
    print(os.environ["FIXTURE_SHA"])
elif args.endswith("/approve"):
    with (root / "approved").open("a") as f: f.write(args + "\\n")
    print("{}")
elif "/pulls/" in args:
    print((root / "pr.json").read_text())
else:
    workflow = "check.yml" if "/check.yml/" in args else "gallery-links.yml"
    counter = root / (workflow + ".reads")
    count = int(counter.read_text()) if counter.exists() else 0
    counter.write_text(str(count + 1))
    run = {"id": 10, "head_sha": os.environ["GITHUB_SHA"],
           "head_repository": {"full_name": "fixture/parlor"},
           "path": ".github/workflows/" + workflow, "event": "pull_request",
           "conclusion": "action_required", "status": "completed"}
    run.update(json.loads(os.environ.get("RUN_OVERRIDE", "{}")))
    missing = os.environ.get("MISSING_RUN") or (os.environ.get("DELAY_RUNS") and count == 0)
    print(json.dumps({"workflow_runs": [] if missing else [run]}))
''')
        gh.chmod(0o755)
        curl = self.cwd / "curl"
        curl.write_text('#!/usr/bin/env python3\nimport os\nprint(os.environ["FIXTURE_LIVE"])\n')
        curl.chmod(0o755)

    def run_command(self, command):
        return subprocess.run(command, cwd=self.cwd, env=self.env, text=True, capture_output=True, check=True)

    def write_config(self, baseline):
        (self.cwd / "release-please-config.json").write_text(json.dumps({"bootstrap-sha": baseline}))

    def current(self):
        return subprocess.run(["bash", str(ROOT / "scripts/release-current.sh")], cwd=self.cwd,
                              env=self.env, text=True, capture_output=True)

    def approve(self):
        (self.cwd / "pr.json").write_text(json.dumps(self.pr))
        script = str(ROOT / "scripts/approve-release-ci.py")
        return subprocess.run(["python3", "-c", "import runpy,time; time.sleep=lambda _:None; runpy.run_path(" + repr(script) + ",run_name='__main__')"], cwd=self.cwd,
                              env=self.env, text=True, capture_output=True)

    def test_native_run_discovery_waits_for_registration(self):
        self.env["DELAY_RUNS"] = "1"
        self.assertEqual(self.approve().returncode, 0)
        self.assertEqual(len((self.cwd / "approved").read_text().splitlines()), 2)
        for workflow in ("check.yml", "gallery-links.yml"):
            self.assertEqual((self.cwd / (workflow + ".reads")).read_text(), "2")

    def test_gate_source_and_live_identity(self):
        self.assertEqual(self.current().returncode, 0)
        self.assertEqual((self.cwd / "output").read_text(), "current=true\n")
        for result in ("failure", "skipped", "cancelled"):
            with self.subTest(result=result):
                self.env["GATE_RESULT"] = result
                self.assertNotEqual(self.current().returncode, 0)
        self.env["GATE_RESULT"] = "success"
        self.env["FIXTURE_LIVE"] = "b" * 40
        self.assertNotEqual(self.current().returncode, 0)
        self.env["FIXTURE_SHA"] = "c" * 40
        (self.cwd / "output").unlink()
        self.assertEqual(self.current().returncode, 0)
        self.assertFalse((self.cwd / "output").exists())
        self.write_config("not-a-baseline")
        self.assertNotEqual(self.current().returncode, 0)
        self.write_config("d" * 40)
        self.assertNotEqual(self.current().returncode, 0)

    def test_native_approval_scope_and_idempotency(self):
        self.assertEqual(self.approve().returncode, 0)
        self.assertEqual(len((self.cwd / "approved").read_text().splitlines()), 2)
        (self.cwd / "approved").unlink()
        self.pr["head"]["ref"] = "release-please--branches--master"
        self.assertNotEqual(self.approve().returncode, 0)
        self.assertFalse((self.cwd / "approved").exists())
        self.pr["head"]["ref"] = json.loads(self.env["RELEASE_PR"])["headBranchName"]
        self.env["RUN_OVERRIDE"] = json.dumps({"conclusion": None, "status": "in_progress"})
        self.assertEqual(self.approve().returncode, 0)
        self.assertFalse((self.cwd / "approved").exists())
        for override in ({"event": "workflow_dispatch"}, {"path": ".github/workflows/other.yml"},
                         {"head_sha": "f" * 40}, {"head_repository": {"full_name": "foreign/parlor"}}):
            with self.subTest(override=override):
                self.env["RUN_OVERRIDE"] = json.dumps(override)
                self.assertNotEqual(self.approve().returncode, 0)
                self.assertFalse((self.cwd / "approved").exists())
        self.env["RUN_OVERRIDE"] = "{}"
        self.env["MISSING_RUN"] = "1"
        self.assertNotEqual(self.approve().returncode, 0)
        del self.env["MISSING_RUN"]
        self.pr["head"]["repo"]["full_name"] = "foreign/parlor"
        self.assertNotEqual(self.approve().returncode, 0)
        self.assertFalse((self.cwd / "approved").exists())

    def test_titles_are_data_and_not_active_markdown(self):
        for title, accepted in (("feat: show source changes", True), ("fix(api)!: require a new export", True),
                                ("docs: explain setup", True), ('fix: preserve $(touch unwanted)', True),
                                ("not conventional", False), ("fix: first\nfeat: second", False),
                                ("fix: <script>alert(1)</script>", False), ("fix: [click](javascript:alert(1))", False)):
            with self.subTest(title=title):
                result = subprocess.run(["node", str(ROOT / "scripts/check-title.mjs")],
                                        cwd=self.cwd, env=dict(self.env, PR_TITLE=title), capture_output=True)
                self.assertEqual(result.returncode == 0, accepted)
                self.assertFalse((self.cwd / "unwanted").exists())


if __name__ == "__main__":
    unittest.main()

"""Approve only the generated PR's current native required-check workflows."""
import json
import os
import subprocess

repo = os.environ["GITHUB_REPOSITORY"]
generated = json.loads(os.environ["RELEASE_PR"])
number = int(generated["number"])


def api(path, method="GET"):
    return json.loads(subprocess.check_output(
        ["gh", "api", "--method", method, f"repos/{repo}/{path}"], text=True
    ) or "null")


pr = api(f"pulls/{number}")
assert pr["state"] == "open" and pr["base"]["ref"] == "master"
assert pr["head"]["repo"]["full_name"] == repo
assert pr["user"]["login"] == "github-actions[bot]"
assert pr["head"]["ref"] == generated["headBranchName"]
sha = pr["head"]["sha"]
for workflow in ("check.yml", "gallery-links.yml"):
    runs = api(f"actions/workflows/{workflow}/runs?event=pull_request&head_sha={sha}")["workflow_runs"]
    runs = [r for r in runs if r["head_sha"] == sha and r["head_repository"]["full_name"] == repo]
    assert runs, f"Missing exact-head native {workflow} run; nothing substituted"
    for run in runs:
        assert run["path"] == f".github/workflows/{workflow}" and run["event"] == "pull_request"
        assert api(f"pulls/{number}")["head"]["sha"] == sha, "Release PR moved"
        if run["conclusion"] == "action_required":
            api(f"actions/runs/{run['id']}/approve", "POST")
            print(f"Approved native {workflow} run {run['id']} at {sha}")
        else:
            print(f"Native {workflow} run {run['id']} already {run['status']}; not restarted")

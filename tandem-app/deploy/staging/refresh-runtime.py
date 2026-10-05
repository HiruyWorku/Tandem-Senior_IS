#!/usr/bin/env python3
"""Fetch the versioned runtime secret with the VM identity; never print its contents."""
import base64
import json
import os
import pathlib
import tempfile
import urllib.request


def fetch(url, headers):
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def main():
    directory = pathlib.Path(__file__).resolve().parent
    project = (directory / "project-id").read_text().strip()
    token = fetch(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        {"Metadata-Flavor": "Google"},
    )["access_token"]
    secret = fetch(
        f"https://secretmanager.googleapis.com/v1/projects/{project}/secrets/tandem-staging-runtime/versions/latest:access",
        {"Authorization": f"Bearer {token}"},
    )
    data = base64.b64decode(secret["payload"]["data"], validate=True)
    if not data or len(data) > 16384:
        raise ValueError("Invalid runtime secret size")
    descriptor, temporary = tempfile.mkstemp(dir=directory, prefix=".runtime-")
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, directory / "runtime.env")
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Runtime secret refresh failed; credentials were not logged.")

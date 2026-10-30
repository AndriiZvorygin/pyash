#!/usr/bin/env python3
"""Send a context-change request to the host's Strata context agent socket."""

import argparse
import http.client
import json
import socket
import sys


class UnixHTTPConnection(http.client.HTTPConnection):
  def __init__(self, socket_path, timeout):
    super().__init__("localhost", timeout=timeout)
    self.socket_path = socket_path

  def connect(self):
    self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    self.sock.settimeout(self.timeout)
    self.sock.connect(self.socket_path)


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--socket", required=True)
  parser.add_argument("--context", required=True, type=int)
  args = parser.parse_args()
  connection = UnixHTTPConnection(args.socket, timeout=220)
  try:
    body = json.dumps({"contextLength": args.context})
    connection.request("POST", "/context", body=body, headers={"Content-Type": "application/json"})
    response = connection.getresponse()
    payload = json.loads(response.read().decode("utf-8"))
    print(json.dumps(payload), flush=True)
    return 0 if 200 <= response.status < 300 else 1
  except Exception as error:
    print(json.dumps({"error": str(error)}), flush=True)
    return 1
  finally:
    connection.close()


if __name__ == "__main__":
  sys.exit(main())

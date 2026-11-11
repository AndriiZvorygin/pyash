#!/usr/bin/env python3
"""Derive the Housekeeper Docker /80 from the host's Docker bridge prefix."""

import ipaddress
import json
import sys


HOUSEKEEPER_WORD = 0x49C6  # nrap
HOUSEKEEPER_PREFIX_LENGTH = 80


def derive_housekeeper_subnet(ipam_config):
  if not isinstance(ipam_config, list):
    raise ValueError("Docker bridge IPAM config must be a list")

  bridge_network = None
  for item in ipam_config:
    if not isinstance(item, dict):
      continue
    try:
      candidate = ipaddress.ip_network(item.get("Subnet", ""), strict=False)
    except ValueError:
      continue
    if candidate.version == 6:
      bridge_network = candidate
      break

  if bridge_network is None:
    raise ValueError(
      "Docker bridge has no IPv6 subnet; enable daemon IPv6 and configure fixed-cidr-v6"
    )

  host_prefix = ipaddress.IPv6Network((bridge_network.network_address, 64), strict=False)
  service_address = int(host_prefix.network_address) | (
    HOUSEKEEPER_WORD << (128 - HOUSEKEEPER_PREFIX_LENGTH)
  )
  return str(ipaddress.IPv6Network((service_address, HOUSEKEEPER_PREFIX_LENGTH)))


def main():
  try:
    ipam_config = json.load(sys.stdin)
    print(derive_housekeeper_subnet(ipam_config))
  except (json.JSONDecodeError, ValueError) as error:
    print(f"housekeeper IPv6 setup failed: {error}", file=sys.stderr)
    return 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())

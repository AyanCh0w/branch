#!/usr/bin/env python3
"""Unpack a Convex backup safely. Never print record data or password hashes."""
import argparse,json,pathlib,zipfile,os
parser=argparse.ArgumentParser();parser.add_argument('snapshot');parser.add_argument('output');a=parser.parse_args()
out=pathlib.Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True);os.chmod(out,0o700)
with zipfile.ZipFile(a.snapshot) as z:
 for item in z.infolist():
  target=(out/item.filename).resolve()
  if not target.is_relative_to(out):raise SystemExit('Unsafe archive path')
  if item.is_dir():target.mkdir(parents=True,exist_ok=True);continue
  target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(item));os.chmod(target,0o600)
print('Private snapshot extracted. Contents were not printed.')

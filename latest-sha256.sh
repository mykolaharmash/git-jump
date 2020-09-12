#!/usr/bin/env bash

# `npm view git-jump dist.tarball` gets tarball URL of the latest package version
# `xargs -n 1 curl --silent -o -` takes output from the previous command (tarball URL) and puts it as the first argument for `curl`, which downloads tarball and outputs it to stdin
# `shasum -a 256` takes SHA256 of stdin content 
# `awk '{print $1}'` takes only the first string of shasum output as it contains other stuff, and the first string is the hash
npm view git-jump dist.tarball | xargs -n 1 curl --silent -o - | shasum -a 256 | awk '{print $1}'
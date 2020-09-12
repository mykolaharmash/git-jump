# Release Instructions

## Publish new NPM package

1. Update help.txt and git-jump.1 if needed
2. Commit
3. `npm version <major | minor | patch>`
4. `git push origin HEAD --tags`
5. `npm publish`

## Update Homebrew formula with new version

1. Get SHA256 of the latest package, run `./latest-sha256.sh`
2. Go to folder with `homebrew-git-jump` repo
3. Insert new package version and SHA hash into `git-jump.rb`
4. Commit
5. `git push origin HEAD`

# Release Instructions

## Publish new NPM package

1. Update help.txt and git-jump.1 if needed
2. Commit
3. `npm version <major | minor | patch>`
4. `git push origin HEAD --tags`
5. `npm publish`

## Update Homebrew formula with new version

1. Check that NPM has published the new version `npm view git-jump dist.tarball`
2. Get SHA256 of the latest package, run `./latest-sha256.sh`
3. Go to folder with `homebrew-git-jump` repo
4. Insert new package version and SHA hash into `git-jump.rb`
5. Commit
6. `git push origin HEAD`

## Create new release on GitHub

1. Go to GitHub and create a new release based on the new tag
2. Describe what has changed in the new version

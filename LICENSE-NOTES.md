# License notes for rbp-cal.diy

This repository is a fork of [calcom/cal.diy](https://github.com/calcom/cal.diy), which is
published under the MIT License (see `LICENSE`) by Cal.com, Inc.

Some files in this fork were restored from this repository's own git history at commit
`ab21c7f805^` (the tree preceding the cal.diy refactor). At that commit the repository was
licensed as AGPLv3 with `/ee` directories under the Cal.com Commercial License.

- Files restored from **non-`/ee` paths** (e.g. `apps/api/v2/src/modules/teams/**`,
  `apps/api/v2/src/modules/organizations/**`) originate from the AGPLv3-licensed portion of
  that tree. To the extent AGPLv3 continues to govern those files, this repository is kept
  public so that the complete corresponding source is available to all network users.
- **No files from `packages/features/ee/**` or other Commercial License directories are
  included in this fork.** Code needed from those areas is independently re-implemented
  against the MIT-licensed tree.

Copyright (c) 2020-present Cal.com, Inc. for all upstream code.

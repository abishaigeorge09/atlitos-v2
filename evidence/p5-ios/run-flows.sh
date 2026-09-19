#!/bin/bash
export PATH="$PATH:$HOME/.maestro/bin"
export MAESTRO_DISABLE_ANALYTICS=1
cd /Users/abishaigeorgegosula/dev/atlitos/.claude/worktrees/agent-a97553600fba0592d
mkdir -p evidence/p5-ios/maestro-runs
: > evidence/p5-ios/maestro-full-run.log
for f in .maestro/*.yaml; do
  name=$(basename "$f" .yaml)
  if [ "$name" = "config" ]; then continue; fi
  echo "=== $name ===" >> evidence/p5-ios/maestro-full-run.log
  maestro test "$f" --udid 8AF6A5E2-F889-4477-8634-97B4AB5D5453 --debug-output "evidence/p5-ios/maestro-runs/$name" >> evidence/p5-ios/maestro-full-run.log 2>&1
  echo "exit: $?" >> evidence/p5-ios/maestro-full-run.log
done
echo ALL_DONE >> evidence/p5-ios/maestro-full-run.log

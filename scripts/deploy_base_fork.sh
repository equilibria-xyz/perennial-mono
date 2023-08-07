yarn workspaces run clean
OPTIMIZER_ENABLED=true yarn workspaces run compile

echo "Deploying protocol..."
yarn workspace @equilibria/perennial run deploy:fork:base --no-compile
echo "done. Deploying oracles..."
yarn workspace @equilibria/perennial-oracle run deploy:fork:base --no-compile
echo "done. Deploying examples..."
yarn workspace @equilibria/perennial-examples run deploy:fork:base --no-compile
echo "done."

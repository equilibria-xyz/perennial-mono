export OPTIMIZER_ENABLED=true
yarn workspaces run clean
yarn workspaces run compile

echo "Deploying protocol..."
yarn workspace @equilibria/perennial run deploy:fork:mainnet
echo "done. Deploying oracles..."
yarn workspace @equilibria/perennial-oracle run deploy:fork:mainnet
echo "done. Deploying examples..."
yarn workspace @equilibria/perennial-examples run deploy:fork:mainnet
echo "done."

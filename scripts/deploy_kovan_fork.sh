yarn workspaces run clean
yarn workspaces run compile

echo "Deploying protocol..."
yarn workspace @equilibria/perennial run deploy:fork:kovan
echo "done. Deploying oracles..."
yarn workspace @equilibria/perennial-oracle run deploy:fork:kovan
echo "done. Deploying examples..."
yarn workspace @equilibria/perennial-examples run deploy:fork:kovan
echo "done."

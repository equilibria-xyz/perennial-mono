import '@nomiclabs/hardhat-ethers'
import { formatEther } from 'ethers/lib/utils'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'

export default task('checkLiquidatable', 'Checks all Product users to see if liquidatable')
  .addPositionalParam('product', 'Product Address to Check')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { get },
    } = HRE
    const collateral = await ethers.getContractAt('ICollateral', (await get('Collateral_Proxy')).address)
    const lens = await ethers.getContractAt('IPerennialLens', (await get('PerennialLens_V01')).address)

    const deposits = await collateral.queryFilter(collateral.filters.Deposit(null, args.product))
    const users = Array.from(new Set([...deposits].map(e => e.args.user.toLowerCase())))
    console.log(`Checking if any of ${users.length} users are liquidatable`)
    for (let i = 0; i < users.length; i++) {
      const account = users[i]
      const liquidatable = await lens.callStatic.liquidatable(account, args.product)
      if (liquidatable) {
        const snapshot = await lens.callStatic['snapshot(address,address)'](account, args.product)
        console.log(`
          Found liquidatable user: ${account},
          position:
            maker: ${formatEther(snapshot.position.maker)}
            taker: ${formatEther(snapshot.position.taker)}
          collateral: ${formatEther(snapshot.collateral)}
        `)
      }
    }
    console.log('done.')
  })

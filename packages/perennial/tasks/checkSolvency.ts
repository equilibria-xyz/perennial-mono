import '@nomiclabs/hardhat-ethers'
import { BigNumber, utils } from 'ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'

export default task('checkSolvency', 'Checks if Product is solvent')
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
    let totalUserCollateral = BigNumber.from(0)
    console.log(`Checking if Product is solvent`)
    for (let i = 0; i < users.length; i++) {
      const account = users[i]
      const collateral = await lens.callStatic['collateral(address,address)'](account, args.product)
      totalUserCollateral = totalUserCollateral.add(collateral)
    }
    const productCollateral = await lens.callStatic['collateral(address)'](args.product)
    const delta = productCollateral.sub(totalUserCollateral)
    if (!delta.isZero()) {
      if (delta.isNegative()) console.log('Product Insolvent')
      else console.log('Product solvent')
      console.log(`Delta: ${utils.formatEther(delta)}`)
    }
    console.log('done.')
  })

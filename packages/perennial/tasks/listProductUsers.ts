import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { writeFile } from 'fs/promises'

export default task('listProductUsers', 'Lists all product users')
  .addPositionalParam('product', 'Product Address to Check')
  .addOptionalParam('output', 'Output file path')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { get },
    } = HRE
    const collateral = await ethers.getContractAt('ICollateral', (await get('Collateral_Proxy')).address)
    const lens = await ethers.getContractAt('IPerennialLens', (await get('PerennialLens_V01')).address)

    const deposits = await collateral.queryFilter(collateral.filters.Deposit(null, args.product))
    const usersCollateral = await Promise.all(
      Array.from(new Set([...deposits].map(e => e.args.user.toLowerCase()))).map(async user => {
        return { user, collateral: await lens.callStatic['collateral(address,address)'](user, args.product) }
      }),
    )
    const users = usersCollateral.filter(({ collateral }) => collateral.gt(0)).map(({ user }) => user)
    if (args.output) {
      await writeFile(args.output, JSON.stringify(users))
    } else {
      console.log(JSON.stringify(users, null, 2))
    }
  })

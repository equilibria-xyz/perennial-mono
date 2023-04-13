import '@nomiclabs/hardhat-ethers'
import { formatEther } from 'ethers/lib/utils'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { providers } from '@0xsequence/multicall'

export function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_: T, i: number) => arr.slice(i * size, i * size + size))
}

export default task('checkLiquidatable', 'Checks all Product users to see if liquidatable')
  .addPositionalParam('product', 'Product Address to Check')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { get },
    } = HRE
    const multicall = new providers.MulticallProvider(ethers.provider)
    const collateral = (await ethers.getContractAt('ICollateral', (await get('Collateral_Proxy')).address)).connect(
      multicall,
    )
    const lens = (await ethers.getContractAt('IPerennialLens', (await get('PerennialLens_V01')).address)).connect(
      multicall,
    )

    const deposits = await collateral.queryFilter(collateral.filters.Deposit(null, args.product))
    const users = Array.from(new Set([...deposits].map(e => e.args.user.toLowerCase())))
    const usersChunked = chunk<string>(users, 50)

    console.log(`Product: ${args.product}. Checking if any of ${users.length} users are liquidatable`)
    for (let i = 0; i < usersChunked.length; i++) {
      const userGroup = usersChunked[i]
      const liquidatable = await Promise.all(
        userGroup.map(account => lens.callStatic.liquidatable(account, args.product)),
      )
      await Promise.all(
        liquidatable.map(async (l, i) => {
          if (l) {
            const snapshot = await lens.callStatic['snapshot(address,address)'](userGroup[i], args.product)
            console.log(`
            Found liquidatable user: ${userGroup[i]},
            position:
              maker: ${formatEther(snapshot.position.maker)}
              taker: ${formatEther(snapshot.position.taker)}
            collateral: ${formatEther(snapshot.collateral)}
          `)
            return true
          }

          return false
        }),
      )
    }
    console.log('done.')
  })

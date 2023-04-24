import { providers } from '@0xsequence/multicall'
import '@nomiclabs/hardhat-ethers'
import { BigNumber, utils } from 'ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { DepositEvent, ICollateral } from '../types/generated/contracts/interfaces/ICollateral'
import { chunk } from './checkLiquidatable'

export default task('checkSolvency', 'Checks if Product is solvent')
  .addPositionalParam('product', 'Product Address to Check')
  .addFlag('findShortfall', 'Finds the users causing a shortfall')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { get },
    } = HRE
    const multicall = new providers.MulticallProvider(ethers.provider)

    const collateralDeployment = await get('Collateral_Proxy')
    const collateral = (await ethers.getContractAt('Collateral', collateralDeployment.address)).connect(multicall)
    const lens = (await ethers.getContractAt('IPerennialLens', (await get('PerennialLens_V01')).address)).connect(
      multicall,
    )
    const currentBlock = await multicall.getBlockNumber()

    const deposits = await getDeposits(
      collateral,
      args.product,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      collateralDeployment.receipt!.blockNumber,
    )

    const users = Array.from(new Set([...deposits].map(e => e.args.user.toLowerCase())))
    const usersChunked = chunk<string>(users, 200)

    let totalUserCollateral = BigNumber.from(0)
    console.log(
      `Checking if Product ${args.product} is solvent. Total users ${users.length}. Groups ${usersChunked.length}`,
    )
    if (args.findShortfall) console.log('Finding shortfall users, may take longer...')

    const allUserCollaterals: { account: string; shortfall: BigNumber; after: BigNumber }[] = []
    const startingShortfall = await lens.callStatic.shortfall(args.product, { blockTag: currentBlock })
    console.log(`Starting shortfall: $${utils.formatEther(startingShortfall)}`)

    for (let i = 0; i < usersChunked.length; i++) {
      console.log(`Checking group ${i + 1} of ${usersChunked.length}...`)
      const userGroup = usersChunked[i]
      let groupHasShortfall = false
      const userCollaterals = await Promise.all(
        userGroup.map(async account => {
          const [after, shortfall] = await Promise.all([
            lens.callStatic['collateral(address,address)'](account, args.product, {
              blockTag: currentBlock,
            }),
            lens.callStatic.shortfall(args.product, {
              blockTag: currentBlock,
            }),
          ])
          if (shortfall.gt(startingShortfall)) groupHasShortfall = true
          return {
            account,
            after,
            shortfall,
          }
        }),
      )

      if (groupHasShortfall && args.findShortfall) {
        console.log('Shortfall found in group. Searching each user...')
        for (const account of userGroup) {
          const [, shortfall] = await Promise.all([
            lens.callStatic['collateral(address,address)'](account, args.product, {
              blockTag: currentBlock,
            }),
            lens.callStatic.shortfall(args.product, {
              blockTag: currentBlock,
            }),
          ])
          if (shortfall.gt(startingShortfall)) {
            console.log(`User ${account} has shortfall of $${utils.formatEther(shortfall)}`)
          }
        }
      }

      totalUserCollateral = totalUserCollateral.add(userCollaterals.reduce((a, b) => a.add(b.after), BigNumber.from(0)))
      allUserCollaterals.push(...userCollaterals)
    }

    const productCollateral = await lens.callStatic['collateral(address)'](args.product, { blockTag: currentBlock })
    const delta = productCollateral.sub(totalUserCollateral)

    if (!delta.isZero()) {
      if (delta.isNegative()) {
        console.log('Product Insolvent')
      } else {
        console.log('Product solvent')
      }

      console.log(`Delta: $${utils.formatEther(delta)}`)
    }

    console.log('done.')
  })

export async function getDeposits(
  collateral: ICollateral,
  productAddress: string,
  deploymentBlockNumber: number,
): Promise<DepositEvent[]> {
  const currentBlock = await collateral.provider.getBlockNumber()
  const deposits: DepositEvent[] = []
  let hasMore = true
  let page = 0

  while (hasMore) {
    console.log(
      `Fetching deposits from block ${currentBlock - (page + 1) * 2000000} to ${currentBlock - page * 2000000}...`,
    )
    deposits.push(
      ...(await collateral.queryFilter(
        collateral.filters.Deposit(null, productAddress),
        currentBlock - (page + 1) * 2000000,
        currentBlock - page * 2000000,
      )),
    )
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    hasMore = currentBlock - page * 2000000 > deploymentBlockNumber - 1
    page = page + 1
  }
  return deposits
}

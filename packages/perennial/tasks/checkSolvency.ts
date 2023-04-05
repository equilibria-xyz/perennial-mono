import { providers } from '@0xsequence/multicall'
import '@nomiclabs/hardhat-ethers'
import { BigNumber, utils } from 'ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { DepositEvent } from '../types/generated/contracts/interfaces/ICollateral'
import { chunk } from './checkLiquidatable'

export default task('checkSolvency', 'Checks if Product is solvent')
  .addPositionalParam('product', 'Product Address to Check')
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

    const deposits: DepositEvent[] = []
    let hasMore = true
    let page = 0

    while (hasMore) {
      console.log(
        `Fetching deposits from block ${currentBlock - (page + 1) * 2000000} to ${currentBlock - page * 2000000}...`,
      )
      deposits.push(
        ...(await collateral.queryFilter(
          collateral.filters.Deposit(null, args.product),
          currentBlock - (page + 1) * 2000000,
          currentBlock - page * 2000000,
        )),
      )
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      hasMore = currentBlock - page * 2000000 > collateralDeployment.receipt!.blockNumber - 1
      page = page + 1
    }

    const users = Array.from(new Set([...deposits].map(e => e.args.user.toLowerCase())))
    const usersChunked = chunk<string>(users, 200)

    let totalUserCollateral = BigNumber.from(0)
    console.log(`Checking if Product is solvent. Total users ${users.length}. Groups ${usersChunked.length}`)

    for (let i = 0; i < usersChunked.length; i++) {
      console.log(`Checking group ${i + 1} of ${usersChunked.length}...`)
      const userGroup = usersChunked[i]
      const userCollaterals = await Promise.all(
        userGroup.map(account =>
          lens.callStatic['collateral(address,address)'](account, args.product, { blockTag: currentBlock }),
        ),
      )
      totalUserCollateral = totalUserCollateral.add(userCollaterals.reduce((a, b) => a.add(b), BigNumber.from(0)))
    }

    const productCollateral = await lens.callStatic['collateral(address)'](args.product, { blockTag: currentBlock })
    const delta = productCollateral.sub(totalUserCollateral)

    if (!delta.isZero()) {
      if (delta.isNegative()) console.log('Product Insolvent')
      else console.log('Product solvent')
      console.log(`Delta: ${utils.formatEther(delta)}`)
    }

    console.log('done.')
  })

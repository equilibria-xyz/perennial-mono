import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { existsSync } from 'fs'
import { appendFile, writeFile } from 'fs/promises'
import { providers } from '@0xsequence/multicall'
import { request, gql } from 'graphql-request'
import { isArbitrum } from '../../common/testutil/network'
import { BigNumber, utils } from 'ethers'
import { Big18Math } from '../../common/testutil/types'

const { formatEther } = utils
const QUERY_PAGE_SIZE = 1000

type QueryResult = {
  takeOpeneds: { amount: string; version: string; fee: string }[]
  takeCloseds: { amount: string; version: string; fee: string }[]
  settles: { toVersion: string; toVersionPrice: string; preVersion: string; preVersionPrice: string }[]
  lastSettle: { blockNumber: string }[]
}

export default task('collectMetrics', 'Collects metrics for a given day')
  .addPositionalParam('dateString', 'Date string to collect stats for. YYYY-MM-DD format')
  .addPositionalParam('market', 'Market to collect stats for. "eth" or "arb"')
  .addOptionalParam('output', 'Output file path')
  .addFlag('csv', 'Output as CSV')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const graphURL = process.env.ARBITRUM_GRAPH_URL
    const startDate = new Date(args.dateString).getTime()
    const endDate = new Date(startDate).setUTCHours(23, 59, 59, 999)
    const outputFile = args.output
    const csv = args.csv

    const {
      ethers,
      deployments: { get, getNetworkName },
    } = HRE
    if (!graphURL || !isArbitrum(getNetworkName())) {
      console.log('Invalid Network.')
      return
    }

    const market = args.market
    const multicall = new providers.MulticallProvider(ethers.provider)
    const lens = (await ethers.getContractAt('IPerennialLens', (await get('PerennialLens_V01')).address)).connect(
      multicall,
    )
    const longProduct =
      market === 'arb' ? (await get('Product_LongArbitrum')).address : (await get('Product_LongEther')).address
    const shortProduct =
      market === 'arb' ? (await get('Product_ShortArbitrum')).address : (await get('Product_ShortEther')).address
    const vault =
      market === 'arb' ? (await get('PerennialVaultBravo')).address : (await get('PerennialVaultAlpha')).address

    const query = gql`
      query getData($markets: [Bytes]!, $fromTs: BigInt!, $toTs: BigInt!, $first: Int!, $skip: Int!) {
        takeOpeneds(
          first: $first
          skip: $skip
          where: { product_in: $markets, blockTimestamp_gte: $fromTs, blockTimestamp_lt: $toTs }
        ) {
          amount
          version
          fee
        }
        takeCloseds(
          first: $first
          skip: $skip
          where: { product_in: $markets, blockTimestamp_gte: $fromTs, blockTimestamp_lt: $toTs }
        ) {
          amount
          version
          fee
        }
        settles(
          first: $first
          skip: $skip
          where: { product_in: $markets, blockTimestamp_gte: $fromTs, blockTimestamp_lt: $toTs }
        ) {
          toVersion
          toVersionPrice
          preVersion
          preVersionPrice
        }
        lastSettle: settles(
          where: { product_in: $markets, blockTimestamp_gte: $fromTs, blockTimestamp_lt: $toTs }
          orderBy: blockTimestamp
          orderDirection: desc
          first: 1
        ) {
          blockNumber
        }
      }
    `

    let page = 0
    let res: QueryResult = await request(graphURL, query, {
      markets: [longProduct, shortProduct],
      fromTs: Math.floor(startDate / 1000).toString(),
      toTs: Math.floor(endDate / 1000).toString(),
      first: QUERY_PAGE_SIZE,
      skip: page * QUERY_PAGE_SIZE,
    })
    const rawData = res
    while (
      res.takeOpeneds.length === QUERY_PAGE_SIZE ||
      res.takeCloseds.length === QUERY_PAGE_SIZE ||
      res.settles.length === QUERY_PAGE_SIZE
    ) {
      page += 1
      res = await request(graphURL, query, {
        markets: [longProduct, shortProduct],
        fromTs: Math.floor(startDate / 1000).toString(),
        toTs: Math.floor(endDate / 1000).toString(),
        first: QUERY_PAGE_SIZE,
        skip: page * QUERY_PAGE_SIZE,
      })
      rawData.takeOpeneds = [...rawData.takeOpeneds, ...res.takeOpeneds]
      rawData.takeCloseds = [...rawData.takeCloseds, ...res.takeCloseds]
      rawData.settles = [...rawData.settles, ...res.settles]
    }

    const takeOpeneds = rawData.takeOpeneds.map(({ amount, version, fee }) => ({
      amount: BigNumber.from(amount),
      version: BigNumber.from(version),
      fee: BigNumber.from(fee),
    }))
    const takeCloseds = rawData.takeCloseds.map(({ amount, version, fee }) => ({
      amount: BigNumber.from(amount),
      version: BigNumber.from(version),
      fee: BigNumber.from(fee),
    }))
    const settles = rawData.settles.map(({ toVersion, toVersionPrice, preVersion, preVersionPrice }) => ({
      toVersion: BigNumber.from(toVersion),
      preVersion: BigNumber.from(preVersion),
      toVersionPrice: BigNumber.from(toVersionPrice),
      preVersionPrice: BigNumber.from(preVersionPrice),
    }))
    const versions = settles.reduce((acc, { toVersion, toVersionPrice, preVersion, preVersionPrice }) => {
      if (!acc[toVersion.toString()]) {
        acc[toVersion.toString()] = toVersionPrice
      }
      if (!acc[preVersion.toString()]) {
        acc[preVersion.toString()] = preVersionPrice
      }
      return acc
    }, {} as { [key: string]: BigNumber })

    const getPrice = (version: BigNumber) =>
      (versions[version.add(1).toString()] ? versions[version.add(1).toString()] : versions[version.toString()]).abs()

    const openVolume = takeOpeneds.reduce(
      (acc, { amount, version }) => Big18Math.mul(getPrice(version), amount).add(acc),
      BigNumber.from(0),
    )
    const closeVolume = takeCloseds.reduce(
      (acc, { amount, version }) => Big18Math.mul(getPrice(version), amount).add(acc),
      BigNumber.from(0),
    )
    const fees = takeOpeneds
      .reduce((acc, { fee }) => fee.add(acc), BigNumber.from(0))
      .add(takeCloseds.reduce((acc, { fee }) => fee.add(acc), BigNumber.from(0)))

    const totalVolume = openVolume.add(closeVolume)

    const endBlock = BigNumber.from(rawData.lastSettle[0].blockNumber)
    const [longSnapshot, shortSnapshot, vaultLongCollateral, vaultShortCollateral] = await Promise.all([
      lens.callStatic['snapshot(address)'](longProduct, { blockTag: endBlock.toHexString() }),
      lens.callStatic['snapshot(address)'](shortProduct, { blockTag: endBlock.toHexString() }),
      lens.callStatic['collateral(address,address)'](vault, longProduct, { blockTag: endBlock.toHexString() }),
      lens.callStatic['collateral(address,address)'](vault, shortProduct, { blockTag: endBlock.toHexString() }),
    ])

    const data = {
      market: market,
      date: args.dateString,
      makerOI: formatEther(longSnapshot.openInterest.maker.add(shortSnapshot.openInterest.maker)),
      takerOI: formatEther(longSnapshot.openInterest.taker.add(shortSnapshot.openInterest.taker)),
      vaultAssets: formatEther(vaultLongCollateral.add(vaultShortCollateral)),
      avgHourlyRate: formatEther(
        longSnapshot.rate
          .add(shortSnapshot.rate)
          .mul(60 * 60)
          .mul(100)
          .div(2),
      ),
      totalVolume: formatEther(totalVolume),
      totalFees: formatEther(fees),
    }

    const str = csv ? Object.values(data).join(',') : JSON.stringify(data, null, outputFile ? 0 : 2)
    if (outputFile) {
      if (!existsSync(outputFile)) {
        await writeFile(outputFile, csv ? Object.keys(data).join(',') : '')
      }

      await appendFile(outputFile, `\n${str}`)
      return
    }

    console.log(str)
  })

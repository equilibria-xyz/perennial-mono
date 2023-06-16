import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { existsSync } from 'fs'
import { appendFile, writeFile } from 'fs/promises'
import { providers } from '@0xsequence/multicall'
import { request, gql } from 'graphql-request'
import { isArbitrum } from '../../common/testutil/network'
import { BigNumber, utils } from 'ethers'
import { chunk } from './checkLiquidatable'

const { formatEther } = utils
const QUERY_PAGE_SIZE = 1000
const QUERY_DATA_POINTS = 100

type QueryResult = {
  bucketedVolumes: {
    product: string
    makerNotional: string
    makerFees: string
    takerNotional: string
    takerFees: string
  }[]
  firstSettle: { blockNumber: string }[]
  lastSettle: { blockNumber: string }[]
}

export default task('collectDailyMetrics', 'Collects metrics for a given day')
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
        bucketedVolumes(
          first: $first
          skip: $skip
          where: {
            bucket: daily
            product_in: $markets
            periodStartTimestamp_gte: $fromTs
            periodStartTimestamp_lt: $toTs
          }
          orderBy: periodStartBlock
          orderDirection: desc
        ) {
          periodStartTimestamp
          product
          makerNotional
          makerFees
          takerNotional
          takerFees
        }
        firstSettle: settles(
          where: { product_in: $markets, blockTimestamp_gte: $fromTs, blockTimestamp_lt: $toTs }
          orderBy: blockTimestamp
          orderDirection: asc
          first: 1
        ) {
          blockNumber
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
    while (res.bucketedVolumes.length === QUERY_PAGE_SIZE) {
      page += 1
      res = await request(graphURL, query, {
        markets: [longProduct, shortProduct],
        fromTs: Math.floor(startDate / 1000).toString(),
        toTs: Math.floor(endDate / 1000).toString(),
        first: QUERY_PAGE_SIZE,
        skip: page * QUERY_PAGE_SIZE,
      })
      rawData.bucketedVolumes = [...rawData.bucketedVolumes, ...res.bucketedVolumes]
    }

    const volumes = rawData.bucketedVolumes.map(({ product, makerNotional, makerFees, takerNotional, takerFees }) => ({
      product: product.toLowerCase(),
      makerNotional: BigNumber.from(makerNotional),
      makerFees: BigNumber.from(makerFees),
      takerNotional: BigNumber.from(takerNotional),
      takerFees: BigNumber.from(takerFees),
    }))

    const totalVolume = volumes.reduce((acc, { takerNotional }) => acc.add(takerNotional), BigNumber.from(0))
    const longFees = volumes
      .filter(({ product }) => product.toLowerCase() === longProduct.toLowerCase())
      .reduce((acc, { takerFees }) => acc.add(takerFees), BigNumber.from(0))
    const shortFees = volumes
      .filter(({ product }) => product.toLowerCase() === shortProduct.toLowerCase())
      .reduce((acc, { takerFees }) => acc.add(takerFees), BigNumber.from(0))

    const startBlock = BigNumber.from(rawData.firstSettle[0].blockNumber)
    const endBlock = BigNumber.from(rawData.lastSettle[0].blockNumber)
    const settleBlocks = endBlock.sub(startBlock).add(1)
    const queryBlocks = chunk(
      new Array(settleBlocks.toNumber()).fill(0).map((_, i) => endBlock.sub(i)),
      settleBlocks.div(QUERY_DATA_POINTS).toNumber(),
    ).map(c => c[0]) // Query 100 datapoints and take average

    const snapshotData = await Promise.all(
      queryBlocks.map(b => {
        return Promise.all([
          lens.callStatic['snapshot(address)'](longProduct, { blockTag: b.toHexString() }),
          lens.callStatic['snapshot(address)'](shortProduct, { blockTag: b.toHexString() }),
          lens.callStatic['snapshot(address,address)'](vault, longProduct, { blockTag: b.toHexString() }),
          lens.callStatic['snapshot(address,address)'](vault, shortProduct, { blockTag: b.toHexString() }),
        ])
      }),
    )

    const {
      longMakerOI,
      shortMakerOI,
      longTakerOI,
      shortTakerOI,
      vaultLongOI,
      vaultShortOI,
      vaultAssets,
      longAvgRate,
      shortAvgRate,
    } = snapshotData.reduce(
      (acc, [longSnapshot, shortSnapshot, vaultLongSnapshot, vaultShortSnapshot]) => {
        return {
          longMakerOI: acc.longMakerOI.add(longSnapshot.openInterest.maker),
          shortMakerOI: acc.shortMakerOI.add(shortSnapshot.openInterest.maker),
          longTakerOI: acc.longTakerOI.add(longSnapshot.openInterest.taker),
          shortTakerOI: acc.shortTakerOI.add(shortSnapshot.openInterest.taker),
          vaultLongOI: acc.vaultLongOI.add(vaultLongSnapshot.openInterest.maker),
          vaultShortOI: acc.vaultShortOI.add(vaultShortSnapshot.openInterest.maker),
          vaultAssets: acc.vaultAssets.add(vaultLongSnapshot.collateral.add(vaultShortSnapshot.collateral)),
          longAvgRate: acc.longAvgRate.add(longSnapshot.rate),
          shortAvgRate: acc.shortAvgRate.add(shortSnapshot.rate),
        }
      },
      {
        longMakerOI: BigNumber.from(0),
        shortMakerOI: BigNumber.from(0),
        longTakerOI: BigNumber.from(0),
        shortTakerOI: BigNumber.from(0),
        vaultLongOI: BigNumber.from(0),
        vaultShortOI: BigNumber.from(0),
        vaultAssets: BigNumber.from(0),
        longAvgRate: BigNumber.from(0),
        shortAvgRate: BigNumber.from(0),
      },
    )

    const data = {
      market: market,
      date: args.dateString,
      longMakerOI: formatEther(longMakerOI.div(queryBlocks.length)),
      shortMakerOI: formatEther(shortMakerOI.div(queryBlocks.length)),
      longTakerOI: formatEther(longTakerOI.div(queryBlocks.length)),
      shortTakerOI: formatEther(shortTakerOI.div(queryBlocks.length)),
      vaultAssets: formatEther(vaultAssets.div(queryBlocks.length)),
      vaultLongOI: formatEther(vaultLongOI.div(queryBlocks.length)),
      vaultShortOI: formatEther(vaultShortOI.div(queryBlocks.length)),
      totalVolume: formatEther(totalVolume),
      longFees: formatEther(longFees),
      shortFees: formatEther(shortFees),
      avgHourlyRate: formatEther(
        longAvgRate
          .add(shortAvgRate)
          .div(queryBlocks.length)
          .mul(60 * 60)
          .mul(100)
          .div(2),
      ),
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

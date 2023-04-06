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
  hourlyVolumes: {
    product: string
    makerNotional: string
    makerFees: string
    takerNotional: string
    takerFees: string
  }[]
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
        hourlyVolumes(
          first: $first
          skip: $skip
          where: { product_in: $markets, periodStartTimestamp_gte: $fromTs, periodStartTimestamp_lt: $toTs }
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
    while (res.hourlyVolumes.length === QUERY_PAGE_SIZE) {
      page += 1
      res = await request(graphURL, query, {
        markets: [longProduct, shortProduct],
        fromTs: Math.floor(startDate / 1000).toString(),
        toTs: Math.floor(endDate / 1000).toString(),
        first: QUERY_PAGE_SIZE,
        skip: page * QUERY_PAGE_SIZE,
      })
      rawData.hourlyVolumes = [...rawData.hourlyVolumes, ...res.hourlyVolumes]
    }

    const hourVolumes = rawData.hourlyVolumes.map(
      ({ product, makerNotional, makerFees, takerNotional, takerFees }) => ({
        product: product.toLowerCase(),
        makerNotional: BigNumber.from(makerNotional),
        makerFees: BigNumber.from(makerFees),
        takerNotional: BigNumber.from(takerNotional),
        takerFees: BigNumber.from(takerFees),
      }),
    )

    const totalVolume = hourVolumes.reduce((acc, { takerNotional }) => acc.add(takerNotional), BigNumber.from(0))
    const longFees = hourVolumes
      .filter(({ product }) => product.toLowerCase() === longProduct.toLowerCase())
      .reduce((acc, { takerFees }) => acc.add(takerFees), BigNumber.from(0))
    const shortFees = hourVolumes
      .filter(({ product }) => product.toLowerCase() === shortProduct.toLowerCase())
      .reduce((acc, { takerFees }) => acc.add(takerFees), BigNumber.from(0))

    const endBlock = BigNumber.from(rawData.lastSettle[0].blockNumber)
    const [longSnapshot, shortSnapshot, vaultLongSnapshot, vaultShortSnapshot] = await Promise.all([
      lens.callStatic['snapshot(address)'](longProduct, { blockTag: endBlock.toHexString() }),
      lens.callStatic['snapshot(address)'](shortProduct, { blockTag: endBlock.toHexString() }),
      lens.callStatic['snapshot(address,address)'](vault, longProduct, { blockTag: endBlock.toHexString() }),
      lens.callStatic['snapshot(address,address)'](vault, shortProduct, { blockTag: endBlock.toHexString() }),
    ])

    const data = {
      market: market,
      date: args.dateString,
      longMakerOI: formatEther(longSnapshot.openInterest.maker),
      shortMakerOI: formatEther(shortSnapshot.openInterest.maker),
      longTakerOI: formatEther(longSnapshot.openInterest.taker),
      shortTakerOI: formatEther(shortSnapshot.openInterest.taker),
      vaultAssets: formatEther(vaultLongSnapshot.collateral.add(vaultShortSnapshot.collateral)),
      vaultLongOI: formatEther(vaultLongSnapshot.openInterest.maker),
      vaultShortOI: formatEther(vaultShortSnapshot.openInterest.maker),
      totalVolume: formatEther(totalVolume),
      longFees: formatEther(longFees),
      shortFees: formatEther(shortFees),
      avgHourlyRate: formatEther(
        longSnapshot.rate
          .add(shortSnapshot.rate)
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

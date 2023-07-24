import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { existsSync } from 'fs'
import { appendFile, writeFile } from 'fs/promises'
import { request, gql } from 'graphql-request'
import { isArbitrum } from '../../common/testutil/network'
import { BigNumber, utils } from 'ethers'

const { formatEther } = utils
const QUERY_PAGE_SIZE = 1000

export function bucketTimestamp(timestampSeconds: number, bucket: 'hourly' | 'daily' | 'weekly'): number {
  let bucketSize
  if (bucket === 'hourly') {
    bucketSize = 3600
  } else if (bucket === 'daily') {
    bucketSize = 86400
  } else if (bucket === 'weekly') {
    bucketSize = 604800
  } else {
    throw new Error(`Invalid bucket: ${bucket}`)
  }

  return Math.floor(timestampSeconds / bucketSize) * bucketSize
}

type VolumeQueryResult = {
  bucketedVolumes: {
    periodStartTimestamp: string
    periodStartVersion: string
    periodEndVersion: string
    product: string
    makerNotional: string
    makerFees: string
    takerNotional: string
    takerFees: string
  }[]
  lastSettle: { blockNumber: string }[]
}

type SettleQueryResult = {
  settles: {
    product: string
    preRate: string
    toRate: string
    preMakerPosition: string
    toMakerPosition: string
  }[]
}

export default task('collectBucketedMetrics', 'Collects metrics for a given date range')
  .addPositionalParam('startDateString', 'Start date string to collect stats for. YYYY-MM-DD format')
  .addPositionalParam('endDateString', 'End date string to collect stats for. YYYY-MM-DD format')
  .addPositionalParam('bucket', 'Bucket granularity: hourly, daily, or weekly')
  .addVariadicPositionalParam('markets', 'Address of market to collect stats for')
  .addOptionalParam('output', 'Output file path')
  .addFlag('csv', 'Output as CSV')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const bucket = args.bucket
    if (bucket !== 'hourly' && bucket !== 'daily' && bucket !== 'weekly') {
      throw new Error('Invalid bucket')
    }

    const startDate = bucketTimestamp(new Date(args.startDateString).getTime() / 1000, bucket)
    const endDate = bucketTimestamp(new Date(args.endDateString).setUTCHours(23, 59, 59, 999) / 1000, bucket)
    const outputFile = args.output
    const csv = args.csv

    const {
      deployments: { getNetworkName },
    } = HRE
    const graphURL = isArbitrum(getNetworkName()) ? process.env.ARBITRUM_GRAPH_URL : process.env.ETHEREUM_GRAPH_URL

    if (!graphURL) {
      console.log('Invalid Network.')
      return
    }

    const markets: string[] = args.markets

    let page = 0
    let res: VolumeQueryResult = await request(graphURL, GET_BUCKETED_VOLUMES_QUERY, {
      markets,
      bucket,
      fromTs: startDate.toString(),
      toTs: endDate.toString(),
      first: QUERY_PAGE_SIZE,
      skip: page * QUERY_PAGE_SIZE,
    })
    const rawData = res
    while (res.bucketedVolumes.length === QUERY_PAGE_SIZE) {
      page += 1
      res = await request(graphURL, GET_BUCKETED_VOLUMES_QUERY, {
        markets,
        bucket,
        fromTs: startDate.toString(),
        toTs: endDate.toString(),
        first: QUERY_PAGE_SIZE,
        skip: page * QUERY_PAGE_SIZE,
      })
      rawData.bucketedVolumes = [...rawData.bucketedVolumes, ...res.bucketedVolumes]
    }

    const hourlyVolumes = await Promise.all(
      rawData.bucketedVolumes.map(
        async ({ periodStartTimestamp, periodStartVersion, periodEndVersion, product, takerFees }) => {
          const settles: SettleQueryResult = await request(graphURL, GET_SETTLES_QUERY, {
            markets: [product],
            fromVersion: periodStartVersion,
            toVersion: periodEndVersion,
          })
          // TODO(arjun): this should be a weighted average
          const averageRate = settles.settles.length
            ? settles.settles
                .reduce((acc, { preRate, toRate }) => {
                  return acc.add(BigNumber.from(preRate).add(toRate).div(2))
                }, BigNumber.from(0))
                .div(settles.settles.length)
            : BigNumber.from(0)
          const averageLiquidity = settles.settles.length
            ? settles.settles
                .reduce((acc, { preMakerPosition, toMakerPosition }) => {
                  return acc.add(BigNumber.from(preMakerPosition).add(toMakerPosition).div(2))
                }, BigNumber.from(0))
                .div(settles.settles.length)
            : BigNumber.from(0)
          return {
            timestamp: parseInt(periodStartTimestamp),
            product: product.toLowerCase(),
            takerFees: `$${formatEther(BigNumber.from(takerFees))}`,
            averageRateAnnualized: `${formatEther(averageRate.mul(60 * 60 * 24 * 365).mul(100))}%`,
            averageLiquidity: `$${formatEther(averageLiquidity)}`,
          }
        },
      ),
    )

    const str = csv
      ? hourlyVolumes.map(o => Object.values(o).join(',')).join('\n')
      : JSON.stringify(hourlyVolumes, null, outputFile ? 0 : 2)
    if (outputFile) {
      if (!existsSync(outputFile)) {
        await writeFile(outputFile, csv ? Object.keys(hourlyVolumes[0]).join(',') : '')
      }

      await appendFile(outputFile, `\n${str}`)
      return
    }

    console.log(str)
  })

const GET_BUCKETED_VOLUMES_QUERY = gql`
  query getData($markets: [Bytes]!, $fromTs: BigInt!, $toTs: BigInt!, $bucket: Bucket!, $first: Int!, $skip: Int!) {
    bucketedVolumes(
      first: $first
      skip: $skip
      where: {
        bucket: $bucket
        product_in: $markets
        periodStartTimestamp_gte: $fromTs
        periodStartTimestamp_lte: $toTs
      }
      orderBy: periodStartBlock
      orderDirection: asc
    ) {
      periodStartTimestamp
      periodStartVersion
      periodEndVersion
      product
      makerNotional
      makerFees
      takerNotional
      takerFees
    }
  }
`

const GET_SETTLES_QUERY = gql`
  query getSettles($markets: [Bytes]!, $fromVersion: BigInt!, $toVersion: BigInt!) {
    settles(where: { product_in: $markets, toVersion_gte: $fromVersion, toVersion_lte: $toVersion }) {
      product
      preRate
      toRate
      preMakerPosition
      toMakerPosition
    }
  }
`

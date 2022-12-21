import { appendFile } from 'fs/promises'
import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { AggregatorProxyInterface__factory, AggregatorV2V3Interface__factory } from '../types/generated'

function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_: T, i: number) => arr.slice(i * size, i * size + size))
}

export default task('enumerateChainlinkRounds', 'Enumerates all of the Rounds for a given Chainlink Phase')
  .addParam('feed', 'Data Feed Aggregator Proxy Address')
  .addParam('phase', 'Phase number to query')
  .addParam('output', 'Output file path', './data.json')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const { ethers } = HRE
    const { BigNumber } = ethers
    const [signer] = await ethers.getSigners()
    const proxy = await AggregatorProxyInterface__factory.connect(args.feed, signer)
    const aggregator = AggregatorV2V3Interface__factory.connect(
      await proxy.phaseAggregators(BigNumber.from(args.phase)),
      signer,
    )

    const latestRound = await aggregator.callStatic.latestRoundData()
    const roundsArr = new Array(latestRound.roundId.toNumber()).fill(0).map((_, i) => i + 1)
    const roundsChunked = chunk<number>(roundsArr, 50)

    await appendFile(args.output, '[')

    for (let index = 0; index < roundsChunked.length; index++) {
      const rounds = roundsChunked[index]
      const data = await Promise.all(
        rounds.map(async roundId => {
          const round = await aggregator.callStatic.getRoundData(roundId)
          return {
            roundId: round.roundId.toNumber(),
            answer: round.answer.toNumber(),
            startedAt: round.startedAt.toNumber(),
            updatedAt: round.updatedAt.toNumber(),
            answeredInRound: round.answeredInRound.toNumber(),
          }
        }),
      )
      await new Promise(resolve => setTimeout(resolve, 500))
      const str = JSON.stringify(data)
      await appendFile(args.output, ',' + str.substring(1, str.length - 1))
    }

    await appendFile(args.output, ']')
  })

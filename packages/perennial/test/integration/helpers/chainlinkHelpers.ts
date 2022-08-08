import HRE from 'hardhat'
import { BigNumber } from 'ethers'
import { smock, MockContract } from '@defi-wonderland/smock'

import {
  FeedRegistryInterface__factory,
  FeedRegistryInterface,
  PassthroughChainlinkFeed,
  PassthroughChainlinkFeed__factory,
} from '../../../types/generated'

const { ethers, deployments } = HRE

export class ChainlinkContext {
  private feedRegistryExternal!: FeedRegistryInterface
  private latestRoundId: BigNumber
  private readonly base: string
  private readonly quote: string

  public feedRegistry!: MockContract<PassthroughChainlinkFeed>

  constructor(base: string, quote: string, initialRoundId: BigNumber) {
    this.base = base
    this.quote = quote
    this.latestRoundId = initialRoundId
  }

  public async init(): Promise<ChainlinkContext> {
    const [owner] = await ethers.getSigners()

    this.feedRegistryExternal = await FeedRegistryInterface__factory.connect(
      (
        await deployments.get('ChainlinkFeedRegistry')
      ).address,
      owner,
    )
    const feedRegistryFactory = await smock.mock<PassthroughChainlinkFeed__factory>('PassthroughChainlinkFeed')
    this.feedRegistry = await feedRegistryFactory.deploy(this.feedRegistryExternal.address)

    const decimals = await this.feedRegistryExternal.decimals(this.base, this.quote)
    this.feedRegistry.decimals.whenCalledWith(this.base, this.quote).returns(decimals)

    const latestData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.latestRoundId)
    this.feedRegistry.latestRoundData.whenCalledWith(this.base, this.quote).returns(latestData)

    return this
  }

  public async next(): Promise<void> {
    this.latestRoundId = await this.feedRegistryExternal.getNextRoundId(this.base, this.quote, this.latestRoundId)
    const latestData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.latestRoundId)
    this.feedRegistry.latestRoundData.reset()
    this.feedRegistry.latestRoundData.whenCalledWith(this.base, this.quote).returns(latestData)
    this.feedRegistry.getRoundData.whenCalledWith(this.base, this.quote, this.latestRoundId).returns(latestData)
  }

  public async nextWithPriceModification(priceFn: (price: BigNumber) => BigNumber): Promise<void> {
    this.latestRoundId = await this.feedRegistryExternal.getNextRoundId(this.base, this.quote, this.latestRoundId)
    const latestData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.latestRoundId)
    const modifiedData = [latestData[0], priceFn(latestData[1]), latestData[2], latestData[3], latestData[4]]
    this.feedRegistry.latestRoundData.reset()
    this.feedRegistry.latestRoundData.whenCalledWith(this.base, this.quote).returns(modifiedData)
    this.feedRegistry.getRoundData.whenCalledWith(this.base, this.quote, this.latestRoundId).returns(modifiedData)
  }

  public async nextWithTimestampModification(timestampFn: (timestamp: BigNumber) => BigNumber): Promise<void> {
    this.latestRoundId = await this.feedRegistryExternal.getNextRoundId(this.base, this.quote, this.latestRoundId)
    const latestData = await this.feedRegistryExternal.getRoundData(this.base, this.quote, this.latestRoundId)
    const modifiedData = [latestData[0], latestData[1], latestData[2], timestampFn(latestData[3]), latestData[4]]
    this.feedRegistry.latestRoundData.reset()
    this.feedRegistry.latestRoundData.whenCalledWith(this.base, this.quote).returns(modifiedData)
    this.feedRegistry.getRoundData.whenCalledWith(this.base, this.quote, this.latestRoundId).returns(modifiedData)
  }
}

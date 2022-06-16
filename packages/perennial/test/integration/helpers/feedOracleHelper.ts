import HRE from 'hardhat'
import { BigNumber } from 'ethers'
import { smock, MockContract } from '@defi-wonderland/smock'

import {
  AggregatorV3Interface__factory,
  AggregatorV3Interface,
  PassthroughDataFeed,
  PassthroughDataFeed__factory,
} from '../../../types/generated'

const { ethers } = HRE

export class DataFeedContext {
  private feedExternalAddress: string
  private feedExternal!: AggregatorV3Interface
  private latestRoundId: BigNumber

  public feed!: MockContract<PassthroughDataFeed>

  constructor(externalFeedAddress: string, latestRoundId: BigNumber) {
    this.feedExternalAddress = externalFeedAddress
    this.latestRoundId = latestRoundId
  }

  public async init(): Promise<DataFeedContext> {
    const [owner] = await ethers.getSigners()

    this.feedExternal = await AggregatorV3Interface__factory.connect(this.feedExternalAddress, owner)
    const feedFactory = await smock.mock<PassthroughDataFeed__factory>('PassthroughDataFeed')
    this.feed = await feedFactory.deploy(this.feedExternal.address)

    const decimals = await this.feedExternal.decimals()
    this.feed.decimals.whenCalledWith().returns(decimals)

    const latestData = await this.feedExternal.getRoundData(this.latestRoundId)
    this.feed.latestRoundData.whenCalledWith().returns(latestData)

    return this
  }

  public async next(): Promise<void> {
    this.latestRoundId = this.latestRoundId.add(1)
    const latestData = await this.feedExternal.getRoundData(this.latestRoundId)
    this.feed.latestRoundData.reset()
    this.feed.latestRoundData.returns(latestData)
    this.feed.getRoundData.whenCalledWith(this.latestRoundId).returns(latestData)
  }

  public async nextWithPriceModification(priceFn: (price: BigNumber) => BigNumber): Promise<void> {
    this.latestRoundId = this.latestRoundId.add(1)
    const latestData = await this.feedExternal.getRoundData(this.latestRoundId)
    const modifiedData = [latestData[0], priceFn(latestData[1]), latestData[2], latestData[3], latestData[4]]
    this.feed.latestRoundData.reset()
    this.feed.latestRoundData.returns(modifiedData)
    this.feed.getRoundData.whenCalledWith(this.latestRoundId).returns(modifiedData)
  }

  public async nextWithTimestampModification(timestampFn: (timestamp: BigNumber) => BigNumber): Promise<void> {
    this.latestRoundId = this.latestRoundId.add(1)
    const latestData = await this.feedExternal.getRoundData(this.latestRoundId)
    const modifiedData = [latestData[0], latestData[1], latestData[2], timestampFn(latestData[3]), latestData[4]]
    this.feed.latestRoundData.reset()
    this.feed.latestRoundData.returns(modifiedData)
    this.feed.getRoundData.whenCalledWith(this.latestRoundId).returns(modifiedData)
  }
}

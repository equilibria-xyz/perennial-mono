import { expect } from 'chai'
import HRE from 'hardhat'
import { Deployment } from 'hardhat-deploy/types'
import { ChainlinkOracle, ChainlinkOracle__factory } from '../../../types/generated'
import { CHAINLINK_CUSTOM_CURRENCIES } from '../../../util'

const { ethers } = HRE

describe('Oracle - ETHUSD - Mainnet Verification', () => {
  let deployments: { [name: string]: Deployment }
  let ethUSDOracle: ChainlinkOracle

  beforeEach(async () => {
    const [signer] = await ethers.getSigners()
    deployments = await HRE.deployments.all()
    ethUSDOracle = await ChainlinkOracle__factory.connect(deployments['ChainlinkOracle_ETH'].address, signer)
  })

  it('has the correct parameters and configuration', async () => {
    expect(await ethUSDOracle.registry()).to.equal(deployments['ChainlinkFeedRegistry'].address)
    expect(await ethUSDOracle.base()).to.equal(CHAINLINK_CUSTOM_CURRENCIES.ETH)
    expect(await ethUSDOracle.quote()).to.equal(CHAINLINK_CUSTOM_CURRENCIES.USD)
  })
})

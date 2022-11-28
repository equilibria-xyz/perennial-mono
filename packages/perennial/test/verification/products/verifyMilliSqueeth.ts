import { expect } from 'chai'
import HRE from 'hardhat'
import { constants, utils } from 'ethers'
import { Deployment } from 'hardhat-deploy/types'
import { Controller, Controller__factory, Product, Product__factory } from '../../../types/generated'

const { ethers } = HRE

describe.only('Product - Milli-Squeeth - Mainnet Verification', () => {
  let deployments: { [name: string]: Deployment }
  let controller: Controller
  let mSqueeth: Product

  beforeEach(async () => {
    const [signer] = await ethers.getSigners()
    deployments = await HRE.deployments.all()
    controller = Controller__factory.connect(deployments['Controller_Proxy'].address, signer)
    mSqueeth = Product__factory.connect(deployments['Product_MilliSqueeth'].address, signer)
  })

  it('is already initialized', async () => {
    await expect(
      mSqueeth.callStatic.initialize({
        name: 'milli-Squeeth',
        symbol: 'mSQTH',
        payoffDefinition: {
          payoffDirection: 1,
          payoffType: 0,
          data: '0x00000000000000000000560276178203095afe2b055eb06e4e9eaf4ce0b1',
        },
        oracle: constants.AddressZero,
        maintenance: 0,
        fundingFee: 0,
        makerFee: 0,
        takerFee: 0,
        makerLimit: 0,
        utilizationCurve: {
          minRate: 0,
          maxRate: 0,
          targetRate: 0,
          targetUtilization: 0,
        },
      }),
    ).to.be.revertedWith('UInitializableAlreadyInitializedError')
  })

  it('has the correct parameters and configuration', async () => {
    expect(await mSqueeth.controller()).to.equal(controller.address)

    expect(await mSqueeth.name()).to.equal('milli-Squeeth')
    expect(await mSqueeth.symbol()).to.equal('mSQTH')
    expect(await mSqueeth.closed()).to.be.false

    const payoffDefinition = await mSqueeth.payoffDefinition()
    expect(payoffDefinition.payoffType).to.equal(1) // Contract
    expect(payoffDefinition.payoffDirection).to.equal(0) // Long
    expect(payoffDefinition.data).to.equal('0x00000000000000000000560276178203095afe2b055eb06e4e9eaf4ce0b1') // Payoff Contract

    expect(await mSqueeth['maintenance()']()).to.equal(utils.parseEther('0.35'))
    expect(await mSqueeth.fundingFee()).to.equal(0)
    expect(await mSqueeth.makerFee()).to.equal(0)
    expect(await mSqueeth.takerFee()).to.equal(0)
    expect(await mSqueeth.makerLimit()).to.equal(0 /* utils.parseEther('750') */)
    expect(await mSqueeth.oracle()).to.equal(deployments['ChainlinkOracle_ETH'].address)

    const utilizationCurve = await mSqueeth.utilizationCurve()
    expect(utilizationCurve.minRate).to.equal(utils.parseEther('0.04'))
    expect(utilizationCurve.maxRate).to.equal(utils.parseEther('16.25'))
    expect(utilizationCurve.targetRate).to.equal(utils.parseEther('1.56'))
    expect(utilizationCurve.targetUtilization).to.equal(utils.parseEther('0.8'))

    expect(await controller['owner(address)'](mSqueeth.address)).to.equal(
      '0xA20ea565cD799e01A86548af5a2929EB7c767fC9' /* '0x609FFF64429e2A275a879e5C50e415cec842c629' */,
    )
  })
})

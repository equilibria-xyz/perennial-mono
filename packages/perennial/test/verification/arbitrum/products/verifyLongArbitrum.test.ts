import { expect } from 'chai'
import HRE from 'hardhat'
import { constants, utils } from 'ethers'
import { Deployment } from 'hardhat-deploy/types'
import { Controller, Controller__factory, Product, Product__factory } from '../../../../types/generated'
import opensPositions from '../../shared/opensPosition.shared'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const { ethers } = HRE

describe('Product - Long Arbitrum - Arbitrum Verification', () => {
  let signer: SignerWithAddress
  let deployments: { [name: string]: Deployment }
  let controller: Controller
  let longArbitrum: Product

  beforeEach(async () => {
    ;[signer] = await ethers.getSigners()
    deployments = await HRE.deployments.all()
    controller = Controller__factory.connect(deployments['Controller_Proxy'].address, signer)
    longArbitrum = Product__factory.connect(deployments['Product_LongArbitrum'].address, signer)
  })

  it('is already initialized', async () => {
    await expect(
      longArbitrum.callStatic.initialize({
        name: 'Arbitrum',
        symbol: 'ARB',
        payoffDefinition: {
          payoffDirection: 0,
          payoffType: 0,
          data: '0x000000000000000000000000000000000000000000000000000000000000',
        },
        oracle: constants.AddressZero,
        maintenance: 0,
        fundingFee: 0,
        makerFee: 0,
        takerFee: 0,
        positionFee: 0,
        makerLimit: 0,
        utilizationCurve: {
          minRate: 0,
          maxRate: 0,
          targetRate: 0,
          targetUtilization: 0,
        },
      }),
    ).to.be.revertedWithCustomError(longArbitrum, 'UInitializableAlreadyInitializedError')
  })

  it('has the correct parameters and configuration', async () => {
    expect(await longArbitrum.controller()).to.equal(controller.address)

    expect(await longArbitrum.name()).to.equal('Arbitrum')
    expect(await longArbitrum.symbol()).to.equal('ARB')
    expect(await longArbitrum.closed()).to.be.false

    const payoffDefinition = await longArbitrum.payoffDefinition()
    expect(payoffDefinition.payoffType).to.equal(0) // Passthrough
    expect(payoffDefinition.payoffDirection).to.equal(0) // Long
    expect(payoffDefinition.data).to.equal('0x000000000000000000000000000000000000000000000000000000000000') // Unused

    expect(await longArbitrum['maintenance()']()).to.equal(utils.parseEther('0.05'))
    expect(await longArbitrum.fundingFee()).to.equal(0)
    expect(await longArbitrum.makerFee()).to.equal(0)
    expect(await longArbitrum.takerFee()).to.equal(utils.parseEther('0.0004'))
    expect(await longArbitrum.makerLimit()).to.equal(utils.parseEther('1000000'))
    expect(await longArbitrum.oracle()).to.equal(deployments['ChainlinkOracle_ARB'].address)

    const utilizationCurve = await longArbitrum.utilizationCurve()
    expect(utilizationCurve.minRate).to.equal(utils.parseEther('0.05'))
    expect(utilizationCurve.maxRate).to.equal(utils.parseEther('2'))
    expect(utilizationCurve.targetRate).to.equal(utils.parseEther('0.35'))
    expect(utilizationCurve.targetUtilization).to.equal(utils.parseEther('0.8'))
  })

  it('opens positions', async () => {
    await opensPositions(longArbitrum, signer, deployments, 'arbitrum', 'arb')
  })
})

import { expect } from 'chai'
import HRE from 'hardhat'
import { constants, utils } from 'ethers'
import { Deployment } from 'hardhat-deploy/types'
import { Controller, Controller__factory, Product, Product__factory } from '../../../../types/generated'
import opensPositions from '../../shared/opensPosition.shared'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const { ethers } = HRE

describe('Product - Short Arbitrum - Arbitrum Verification', () => {
  let signer: SignerWithAddress
  let deployments: { [name: string]: Deployment }
  let controller: Controller
  let shortArbitrum: Product

  beforeEach(async () => {
    ;[signer] = await ethers.getSigners()
    deployments = await HRE.deployments.all()
    controller = Controller__factory.connect(deployments['Controller_Proxy'].address, signer)
    shortArbitrum = Product__factory.connect(deployments['Product_ShortArbitrum'].address, signer)
  })

  it('is already initialized', async () => {
    await expect(
      shortArbitrum.callStatic.initialize({
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
    ).to.be.revertedWithCustomError(shortArbitrum, 'UInitializableAlreadyInitializedError')
  })

  it('has the correct parameters and configuration', async () => {
    expect(await shortArbitrum.controller()).to.equal(controller.address)

    expect(await shortArbitrum.name()).to.equal('Arbitrum')
    expect(await shortArbitrum.symbol()).to.equal('ARB')
    expect(await shortArbitrum.closed()).to.be.false

    const payoffDefinition = await shortArbitrum.payoffDefinition()
    expect(payoffDefinition.payoffType).to.equal(0) // Passthrough
    expect(payoffDefinition.payoffDirection).to.equal(1) // Short
    expect(payoffDefinition.data).to.equal('0x000000000000000000000000000000000000000000000000000000000000') // Unused

    expect(await shortArbitrum['maintenance()']()).to.equal(utils.parseEther('0.05'))
    expect(await shortArbitrum.fundingFee()).to.equal(0)
    expect(await shortArbitrum.makerFee()).to.equal(0)
    expect(await shortArbitrum.takerFee()).to.equal(utils.parseEther('0.0004'))
    expect(await shortArbitrum.makerLimit()).to.equal(utils.parseEther('1000000'))
    expect(await shortArbitrum.oracle()).to.equal(deployments['ChainlinkOracle_ARB'].address)

    const utilizationCurve = await shortArbitrum.utilizationCurve()
    expect(utilizationCurve.minRate).to.equal(utils.parseEther('0.05'))
    expect(utilizationCurve.maxRate).to.equal(utils.parseEther('2'))
    expect(utilizationCurve.targetRate).to.equal(utils.parseEther('0.35'))
    expect(utilizationCurve.targetUtilization).to.equal(utils.parseEther('0.8'))
  })

  it('opens positions', async () => {
    await opensPositions(shortArbitrum, signer, deployments, 'arbitrum', 'arb')
  })
})

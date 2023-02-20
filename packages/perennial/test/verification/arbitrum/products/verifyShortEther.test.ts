import { expect } from 'chai'
import HRE from 'hardhat'
import { constants, utils } from 'ethers'
import { Deployment } from 'hardhat-deploy/types'
import { Controller, Controller__factory, Product, Product__factory } from '../../../../types/generated'
import opensPositions from '../../shared/opensPosition.shared'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const { ethers } = HRE

describe('Product - Short Ether - Arbitrum Verification', () => {
  let signer: SignerWithAddress
  let deployments: { [name: string]: Deployment }
  let controller: Controller
  let shortEther: Product

  beforeEach(async () => {
    ;[signer] = await ethers.getSigners()
    deployments = await HRE.deployments.all()
    controller = Controller__factory.connect(deployments['Controller_Proxy'].address, signer)
    shortEther = Product__factory.connect(deployments['Product_ShortEther'].address, signer)
  })

  it('is already initialized', async () => {
    await expect(
      shortEther.callStatic.initialize({
        name: 'Ether',
        symbol: 'ETH',
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
    ).to.be.revertedWithCustomError(shortEther, 'UInitializableAlreadyInitializedError')
  })

  it('has the correct parameters and configuration', async () => {
    expect(await shortEther.controller()).to.equal(controller.address)

    expect(await shortEther.name()).to.equal('Ether')
    expect(await shortEther.symbol()).to.equal('ETH')
    expect(await shortEther.closed()).to.be.false

    const payoffDefinition = await shortEther.payoffDefinition()
    expect(payoffDefinition.payoffType).to.equal(0) // Passthrough
    expect(payoffDefinition.payoffDirection).to.equal(1) // Short
    expect(payoffDefinition.data).to.equal('0x000000000000000000000000000000000000000000000000000000000000') // Unused

    expect(await shortEther['maintenance()']()).to.equal(utils.parseEther('0.05'))
    expect(await shortEther.fundingFee()).to.equal(0)
    expect(await shortEther.makerFee()).to.equal(0)
    expect(await shortEther.takerFee()).to.equal(0)
    expect(await shortEther.makerLimit()).to.equal(utils.parseEther('2000'))
    expect(await shortEther.oracle()).to.equal(deployments['ChainlinkOracle_ETH'].address)

    const utilizationCurve = await shortEther.utilizationCurve()
    expect(utilizationCurve.minRate).to.equal(utils.parseEther('0.00'))
    expect(utilizationCurve.maxRate).to.equal(utils.parseEther('1.2'))
    expect(utilizationCurve.targetRate).to.equal(utils.parseEther('0.06'))
    expect(utilizationCurve.targetUtilization).to.equal(utils.parseEther('0.8'))
  })

  it('opens positions', async () => {
    await opensPositions(shortEther, signer, deployments, 'arbitrum')
  })
})

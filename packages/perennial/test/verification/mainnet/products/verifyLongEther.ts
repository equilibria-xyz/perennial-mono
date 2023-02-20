import { expect } from 'chai'
import HRE from 'hardhat'
import { constants, utils } from 'ethers'
import { Deployment } from 'hardhat-deploy/types'
import { Controller, Controller__factory, Product, Product__factory } from '../../../../types/generated'
import opensPositions from '../../shared/opensPosition.shared'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const { ethers } = HRE

describe('Product - Long Ether - Mainnet Verification', () => {
  let signer: SignerWithAddress
  let deployments: { [name: string]: Deployment }
  let controller: Controller
  let longEther: Product

  beforeEach(async () => {
    ;[signer] = await ethers.getSigners()
    deployments = await HRE.deployments.all()
    controller = Controller__factory.connect(deployments['Controller_Proxy'].address, signer)
    longEther = Product__factory.connect(deployments['Product_LongEther'].address, signer)
  })

  it('is already initialized', async () => {
    await expect(
      longEther.callStatic.initialize({
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
    ).to.be.revertedWithCustomError(longEther, 'UInitializableAlreadyInitializedError')
  })

  it('has the correct parameters and configuration', async () => {
    expect(await longEther.controller()).to.equal(controller.address)

    expect(await longEther.name()).to.equal('Ether')
    expect(await longEther.symbol()).to.equal('ETH')
    expect(await longEther.closed()).to.be.false

    const payoffDefinition = await longEther.payoffDefinition()
    expect(payoffDefinition.payoffType).to.equal(0) // Passthrough
    expect(payoffDefinition.payoffDirection).to.equal(0) // Long
    expect(payoffDefinition.data).to.equal('0x000000000000000000000000000000000000000000000000000000000000') // Unused

    expect(await longEther['maintenance()']()).to.equal(utils.parseEther('0.1'))
    expect(await longEther.fundingFee()).to.equal(0)
    expect(await longEther.makerFee()).to.equal(0)
    expect(await longEther.takerFee()).to.equal(0)
    expect(await longEther.makerLimit()).to.equal(utils.parseEther('1800'))
    expect(await longEther.oracle()).to.equal(deployments['ChainlinkOracle_ETH'].address)

    const utilizationCurve = await longEther.utilizationCurve()
    expect(utilizationCurve.minRate).to.equal(utils.parseEther('0.00'))
    expect(utilizationCurve.maxRate).to.equal(utils.parseEther('0.80'))
    expect(utilizationCurve.targetRate).to.equal(utils.parseEther('0.06'))
    expect(utilizationCurve.targetUtilization).to.equal(utils.parseEther('0.8'))
  })

  it('opens positions', async () => {
    await opensPositions(longEther, signer, deployments)
  })
})

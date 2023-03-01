import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  ICollateral,
  PerennialLens,
  PerennialLens__factory,
  IProduct,
  IContractPayoffProvider,
  IController,
  IIncentivizer,
} from '../../../types/generated'
import { createPayoffDefinition, expectPositionEq, expectPrePositionEq } from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const { ethers } = HRE
use(smock.matchers)

describe('PerennialLens', () => {
  let user: SignerWithAddress
  let protocolTreasury: SignerWithAddress
  let productTreasury: SignerWithAddress
  let collateral: FakeContract<ICollateral>
  let product: FakeContract<IProduct>
  let payoffProvider: FakeContract<IContractPayoffProvider>
  let controller: FakeContract<IController>
  let incentivizer: FakeContract<IIncentivizer>
  let lens: PerennialLens

  const lensFixture = async () => {
    ;[user, protocolTreasury, productTreasury] = await ethers.getSigners()
  }

  beforeEach(async () => {
    await loadFixture(lensFixture)

    collateral = await smock.fake<ICollateral>('ICollateral')
    product = await smock.fake<IProduct>('IProduct')
    payoffProvider = await smock.fake<IContractPayoffProvider>('IContractPayoffProvider')
    controller = await smock.fake<IController>('IController')
    incentivizer = await smock.fake<IIncentivizer>('IIncentivizer')

    controller.collateral.returns(collateral.address)
    controller.incentivizer.returns(incentivizer.address)
    controller.protocolFee.returns(ethers.utils.parseEther('0.01'))
    controller.liquidationFee.returns(ethers.utils.parseEther('0.05'))
    controller.minCollateral.returns(ethers.utils.parseEther('1000'))

    collateral.token.returns('0x605D26FBd5be761089281d5cec2Ce86eeA667109')

    product.name.returns('Product')
    product.symbol.returns('PROD')
    product.oracle.returns('0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b')
    product.payoffDefinition.returns(createPayoffDefinition({ contractAddress: payoffProvider.address }))
    product['maintenance()'].returns(ethers.utils.parseEther('0.1'))
    product.fundingFee.returns(ethers.utils.parseEther('0.2'))
    product.makerFee.returns(ethers.utils.parseEther('0.3'))
    product.takerFee.returns(ethers.utils.parseEther('0.4'))
    product.makerLimit.returns(ethers.utils.parseEther('100'))
    product.utilizationCurve.returns({
      minRate: ethers.utils.parseEther('0.10'),
      maxRate: ethers.utils.parseEther('0.10'),
      targetRate: ethers.utils.parseEther('0.10'),
      targetUtilization: ethers.utils.parseEther('1'),
    })

    lens = await new PerennialLens__factory(user).deploy(controller.address)
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      expect(await lens.controller()).to.equal(controller.address)
      expect(await lens['collateral()']()).to.equal(collateral.address)
    })
  })

  describe('snapshot', () => {
    it('returns the protocol snapshot', async () => {
      controller.paused.returns(true)

      const snapshot = await lens.callStatic['snapshot()']()
      expect(snapshot.collateral).to.equal(collateral.address)
      expect(snapshot.incentivizer).to.equal(incentivizer.address)
      expect(snapshot.collateralToken).to.equal('0x605D26FBd5be761089281d5cec2Ce86eeA667109')
      expect(snapshot.protocolFee).to.equal(ethers.utils.parseEther('0.01'))
      expect(snapshot.liquidationFee).to.equal(ethers.utils.parseEther('0.05'))
      expect(snapshot.minCollateral).to.equal(ethers.utils.parseEther('1000'))
      expect(snapshot.paused).to.be.true
    })
  })

  describe('snapshots(address[])', () => {
    it('returns the product snapshots', async () => {
      const product2 = await smock.fake<IProduct>('IProduct')
      const snapshots = await lens.callStatic['snapshots(address[])']([product.address, product2.address])
      expect(snapshots[0].productAddress).to.equal(product.address)
      expect(snapshots[1].productAddress).to.equal(product2.address)
      expect(product.settle).to.have.be.called
      expect(product2.settle).to.have.be.called
    })
  })

  describe('snapshots(address)', () => {
    it('returns the product snapshot', async () => {
      const snapshot = await lens.callStatic['snapshot(address)'](product.address)
      expect(snapshot.productAddress).to.equal(product.address)
      expect(product.settle).to.have.be.called
    })
  })

  describe('snapshots(address,address[])', () => {
    it('returns the userproduct snapshots', async () => {
      const product2 = await smock.fake<IProduct>('IProduct')
      const snapshots = await lens.callStatic['snapshots(address,address[])'](user.address, [
        product.address,
        product2.address,
      ])
      expect(snapshots[0].productAddress).to.equal(product.address)
      expect(snapshots[0].userAddress).to.equal(user.address)
      expect(snapshots[1].productAddress).to.equal(product2.address)
      expect(snapshots[1].userAddress).to.equal(user.address)
      expect(product.settleAccount).to.have.be.calledWith(user.address)
      expect(product2.settleAccount).to.have.be.calledWith(user.address)
    })
  })

  describe('snapshot(address,address)', () => {
    it('returns the userproduct snapshot', async () => {
      const snapshot = await lens.callStatic['snapshot(address,address)'](user.address, product.address)
      expect(snapshot.productAddress).to.equal(product.address)
      expect(snapshot.userAddress).to.equal(user.address)
      expect(product.settleAccount).to.have.be.calledWith(user.address)
    })
  })

  describe('#name', () => {
    it('returns the name of the product', async () => {
      expect(await lens.callStatic.name(product.address)).to.equal('Product')
    })
  })

  describe('#symbol', () => {
    it('returns the symbol of the product', async () => {
      expect(await lens.callStatic.symbol(product.address)).to.equal('PROD')
    })
  })

  describe('#info', () => {
    it('returns the info of the product', async () => {
      const info = await lens.callStatic.info(product.address)
      expect(info.name).to.equal('Product')
      expect(info.symbol).to.equal('PROD')
      expect(info.payoffDefinition.payoffType).to.equal(1)
      expect(info.payoffDefinition.payoffDirection).to.equal(0)
      expect(info.payoffDefinition.data).to.equal(
        `0x00000000000000000000${payoffProvider.address.substring(2).toLowerCase()}`,
      )
      expect(info.oracle).to.equal('0x52C64b8998eB7C80b6F526E99E29ABdcC86B841b')
      expect(info.maintenance).to.equal(ethers.utils.parseEther('0.1'))
      expect(info.fundingFee).to.equal(ethers.utils.parseEther('0.2'))
      expect(info.makerFee).to.equal(ethers.utils.parseEther('0.3'))
      expect(info.takerFee).to.equal(ethers.utils.parseEther('0.4'))
      expect(info.makerLimit).to.equal(ethers.utils.parseEther('100'))
      expect(info.utilizationCurve.minRate).to.equal(ethers.utils.parseEther('0.10'))
      expect(info.utilizationCurve.maxRate).to.equal(ethers.utils.parseEther('0.10'))
      expect(info.utilizationCurve.targetRate).to.equal(ethers.utils.parseEther('0.10'))
      expect(info.utilizationCurve.targetUtilization).to.equal(ethers.utils.parseEther('1'))
    })
  })

  describe('#collateral(address,address)', () => {
    it('returns the user collateral amount after settle', async () => {
      collateral['collateral(address,address)'].whenCalledWith(user.address, product.address).returns(100)
      expect(await lens.callStatic['collateral(address,address)'](user.address, product.address)).to.equal(100)
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#collateral(address)', () => {
    it('returns the product collateral amount after settle', async () => {
      collateral['collateral(address)'].whenCalledWith(product.address).returns(200)
      expect(await lens.callStatic['collateral(address)'](product.address)).to.equal(200)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#shortfall', () => {
    it('returns the product shortfall amount after settle', async () => {
      collateral.shortfall.whenCalledWith(product.address).returns(300)
      expect(await lens.callStatic.shortfall(product.address)).to.equal(300)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#maintenance', () => {
    it('returns the user maintenance amount after settle', async () => {
      product['maintenance(address)'].whenCalledWith(user.address).returns(10)
      product.maintenanceNext.whenCalledWith(user.address).returns(8)
      expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal(10)
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })

    it('returns maintenanceNext if it is higher than maintenance', async () => {
      product['maintenance(address)'].whenCalledWith(user.address).returns(10)
      product.maintenanceNext.whenCalledWith(user.address).returns(15)
      expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal(15)
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#liquidatable', () => {
    it('returns whether or not the user is liquidatable after settle', async () => {
      collateral.liquidatable.whenCalledWith(user.address, product.address).returns(true)
      expect(await lens.callStatic.liquidatable(user.address, product.address)).to.equal(true)
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#liquidating', () => {
    it('returns whether or not the user is being liquidated after settle', async () => {
      product.isLiquidating.whenCalledWith(user.address).returns(true)
      expect(await lens.callStatic.liquidating(user.address, product.address)).to.equal(true)
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#pre(address,address)', () => {
    it('returns the user preposition after settle', async () => {
      const pos = {
        oracleVersion: 1,
        openPosition: { maker: 100, taker: 0 },
        closePosition: { maker: 0, taker: 100 },
      }
      product['pre(address)'].whenCalledWith(user.address).returns(pos)
      expectPrePositionEq(await lens.callStatic['pre(address,address)'](user.address, product.address), pos)
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#pre(address)', () => {
    it('returns the global preposition after settle', async () => {
      const pos = {
        oracleVersion: 1,
        openPosition: { maker: 100, taker: 0 },
        closePosition: { maker: 0, taker: 100 },
      }
      product['pre()'].returns(pos)
      expectPrePositionEq(await lens.callStatic['pre(address)'](product.address), pos)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#position(address,address)', () => {
    it('returns the user position after settle', async () => {
      product.position.whenCalledWith(user.address).returns({ maker: 100, taker: 200 })
      expectPositionEq(await lens.callStatic['position(address,address)'](user.address, product.address), {
        maker: 100,
        taker: 200,
      })
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#position(address)', () => {
    it('returns the global position after settle', async () => {
      product['latestVersion()'].returns(100)
      product.positionAtVersion.whenCalledWith(100).returns({ maker: 200, taker: 100 })
      expectPositionEq(await lens.callStatic['position(address)'](product.address), {
        maker: 200,
        taker: 100,
      })
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#userPosition', () => {
    it('returns the user prePosition and position after settle', async () => {
      const pos = {
        oracleVersion: 1,
        openPosition: { maker: 100, taker: 0 },
        closePosition: { maker: 0, taker: 100 },
      }
      product['pre(address)'].whenCalledWith(user.address).returns(pos)
      product.position.whenCalledWith(user.address).returns({ maker: 100, taker: 200 })
      const userPosition = await lens.callStatic.userPosition(user.address, product.address)
      expectPrePositionEq(userPosition[0], pos)
      expectPositionEq(userPosition[1], { maker: 100, taker: 200 })
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#globalPosition', () => {
    it('returns the global prePosition and position after settle', async () => {
      const pos = {
        oracleVersion: 1,
        openPosition: { maker: 100, taker: 0 },
        closePosition: { maker: 0, taker: 100 },
      }
      product['pre()'].returns(pos)
      product['latestVersion()'].returns(100)
      product.positionAtVersion.whenCalledWith(100).returns({ maker: 100, taker: 200 })
      const globalPosition = await lens.callStatic.globalPosition(product.address)
      expectPrePositionEq(globalPosition[0], pos)
      expectPositionEq(globalPosition[1], { maker: 100, taker: 200 })
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#openInterest(address,address)', () => {
    it('returns the global position after settle', async () => {
      const currVersion = {
        version: 1,
        timestamp: 456,
        price: -789,
      }
      product.position.whenCalledWith(user.address).returns({ maker: ethers.utils.parseEther('100'), taker: 0 })
      product.atVersion.returns(currVersion)
      expectPositionEq(await lens.callStatic['openInterest(address,address)'](user.address, product.address), {
        maker: 78900,
        taker: 0,
      })
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#exposure', () => {
    context('maker, less than 100% utilization', () => {
      it('returns user exposure after settle', async () => {
        const pre = {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        }
        product['pre()'].returns(pre)
        product['latestVersion()'].returns(100)
        product.positionAtVersion
          .whenCalledWith(100)
          .returns({ maker: ethers.utils.parseEther('100'), taker: ethers.utils.parseEther('50') })
        const currVersion = {
          version: 1,
          timestamp: 456,
          price: ethers.utils.parseEther('-789'),
        }
        product.position.whenCalledWith(user.address).returns({ maker: ethers.utils.parseEther('1'), taker: 0 })
        product.atVersion.whenCalledWith(100).returns(currVersion)
        expect(await lens.callStatic.exposure(user.address, product.address)).to.equal(ethers.utils.parseEther('394.5'))
        expect(product.settleAccount).to.have.been.calledWith(user.address)
      })
    })

    context('taker', () => {
      it('returns user exposure after settle', async () => {
        const pre = {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        }
        product['pre()'].returns(pre)
        product['latestVersion()'].returns(100)
        product.positionAtVersion
          .whenCalledWith(100)
          .returns({ maker: ethers.utils.parseEther('100'), taker: ethers.utils.parseEther('50') })
        const currVersion = {
          version: 1,
          timestamp: 456,
          price: ethers.utils.parseEther('-789'),
        }
        product.position.whenCalledWith(user.address).returns({ maker: 0, taker: ethers.utils.parseEther('1') })
        product.atVersion.whenCalledWith(100).returns(currVersion)
        expect(await lens.callStatic.exposure(user.address, product.address)).to.equal(ethers.utils.parseEther('789'))
        expect(product.settleAccount).to.have.been.calledWith(user.address)
      })
    })
  })

  describe('#openInterest(address)', () => {
    it('returns the global position after settle', async () => {
      const currVersion = {
        version: 1,
        timestamp: 456,
        price: -789,
      }
      product['latestVersion()'].returns(100)
      product.positionAtVersion
        .whenCalledWith(100)
        .returns({ maker: ethers.utils.parseEther('200'), taker: ethers.utils.parseEther('100') })
      product.atVersion.returns(currVersion)
      expectPositionEq(await lens.callStatic['openInterest(address)'](product.address), {
        maker: 157800,
        taker: 78900,
      })
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#latestVersion', () => {
    it('returns the price after settle', async () => {
      const currVersion = {
        version: 1,
        timestamp: 456,
        price: 789,
      }
      product.atVersion.returns(currVersion)
      const latestVersion = await lens.callStatic.latestVersion(product.address)
      expect(latestVersion.version).to.equal(1)
      expect(latestVersion.timestamp).to.equal(456)
      expect(latestVersion.price).to.equal(789)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#atVersions', () => {
    it('returns the prices at versions after settle', async () => {
      const atVersion1 = {
        version: 1,
        timestamp: 456,
        price: 789,
      }
      const atVersion10 = {
        version: 10,
        timestamp: 512,
        price: 100,
      }
      const atVersion21 = {
        version: 21,
        timestamp: 620,
        price: 890,
      }
      product.atVersion.whenCalledWith(1).returns(atVersion1)
      product.atVersion.whenCalledWith(10).returns(atVersion10)
      product.atVersion.whenCalledWith(21).returns(atVersion21)
      const prices = await lens.callStatic.atVersions(product.address, [1, 10, 21])
      expect(prices[0].version).to.equal(1)
      expect(prices[0].timestamp).to.equal(456)
      expect(prices[0].price).to.equal(789)

      expect(prices[1].version).to.equal(10)
      expect(prices[1].timestamp).to.equal(512)
      expect(prices[1].price).to.equal(100)

      expect(prices[2].version).to.equal(21)
      expect(prices[2].timestamp).to.equal(620)
      expect(prices[2].price).to.equal(890)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#rate', () => {
    it('returns the rate after settle', async () => {
      product['latestVersion()'].returns(100)
      product.positionAtVersion.whenCalledWith(100).returns({ maker: 200, taker: 100 })
      product.rate.returns(12345)
      expect(await lens.callStatic.rate(product.address)).to.equal(12345)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#dailyRate', () => {
    it('returns the rate after settle', async () => {
      product['latestVersion()'].returns(100)
      product.positionAtVersion.whenCalledWith(100).returns({ maker: 200, taker: 100 })
      product.rate.returns(12345)
      expect(await lens.callStatic.dailyRate(product.address)).to.equal(1066608000)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#maintenanceRequired', () => {
    it('returns the maintenance required after settle', async () => {
      const currVersion = {
        version: 1,
        timestamp: 456,
        price: -789,
      }
      product.atVersion.returns(currVersion)
      product['maintenance()'].returns(ethers.utils.parseEther('0.5'))
      expect(
        await lens.callStatic.maintenanceRequired(user.address, product.address, ethers.utils.parseEther('123')),
      ).to.equal(48523)
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#fees(address)', () => {
    it('returns the protocol and product fees', async () => {
      controller['treasury()'].returns(protocolTreasury.address)
      controller['treasury(address)'].whenCalledWith(product.address).returns(productTreasury.address)
      collateral.fees.whenCalledWith(protocolTreasury.address).returns(ethers.utils.parseEther('123'))
      collateral.fees.whenCalledWith(productTreasury.address).returns(ethers.utils.parseEther('456'))

      const fees = await lens.callStatic['fees(address)'](product.address)
      expect(fees.protocolFees).to.equal(ethers.utils.parseEther('123'))
      expect(fees.productFees).to.equal(ethers.utils.parseEther('456'))
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#fees(address,address)', () => {
    it('returns the total fees after settling', async () => {
      collateral.fees.whenCalledWith(user.address).returns(ethers.utils.parseEther('12345'))

      const fees = await lens.callStatic['fees(address,address)'](user.address, product.address)
      expect(fees).to.equal(ethers.utils.parseEther('12345'))
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#unclaimedIncentiveRewards(address,address)', () => {
    it('returns the tokens and amounts of unclaimed rewards for all programs', async () => {
      const addr0 = '0xdbbffbdeed3fe14741f32e6d746dd68758f01cad'
      const addr1 = '0xa0134dc26517db8a7cbb13da1c428a6022f04f92'
      incentivizer.count.whenCalledWith(product.address).returns(2)

      incentivizer.programInfos
        .whenCalledWith(product.address, 0)
        .returns({ token: addr0, amount: { maker: 100, taker: 200 }, start: 1, duration: 2, coordinatorId: 0 })
      incentivizer.programInfos
        .whenCalledWith(product.address, 1)
        .returns({ token: addr1, amount: { maker: 100, taker: 200 }, start: 1, duration: 2, coordinatorId: 0 })

      incentivizer.unclaimed.whenCalledWith(product.address, user.address, 0).returns(ethers.utils.parseEther('123'))
      incentivizer.unclaimed.whenCalledWith(product.address, user.address, 1).returns(ethers.utils.parseEther('456'))

      const unclaimed = await lens.callStatic['unclaimedIncentiveRewards(address,address)'](
        user.address,
        product.address,
      )
      expect(unclaimed.tokens[0].toLowerCase()).to.equal(addr0)
      expect(unclaimed.amounts[0]).to.equal(ethers.utils.parseEther('123'))
      expect(unclaimed.tokens[1].toLowerCase()).to.equal(addr1)
      expect(unclaimed.amounts[1]).to.equal(ethers.utils.parseEther('456'))
    })
  })

  describe('#unclaimedIncentiveRewards(address,address,uint256[])', () => {
    it('returns the tokens and amounts of unclaimed rewards for passed in program IDs', async () => {
      const addr0 = '0xdbbffbdeed3fe14741f32e6d746dd68758f01cad'
      const addr1 = '0xa0134dc26517db8a7cbb13da1c428a6022f04f92'

      incentivizer.programInfos
        .whenCalledWith(product.address, 1)
        .returns({ token: addr0, amount: { maker: 100, taker: 200 }, start: 1, duration: 2, coordinatorId: 0 })
      incentivizer.programInfos
        .whenCalledWith(product.address, 2)
        .returns({ token: addr1, amount: { maker: 100, taker: 200 }, start: 1, duration: 2, coordinatorId: 0 })

      incentivizer.unclaimed.whenCalledWith(product.address, user.address, 1).returns(ethers.utils.parseEther('123'))
      incentivizer.unclaimed.whenCalledWith(product.address, user.address, 2).returns(ethers.utils.parseEther('456'))

      const unclaimed = await lens.callStatic['unclaimedIncentiveRewards(address,address,uint256[])'](
        user.address,
        product.address,
        [1, 2],
      )
      expect(unclaimed.tokens[0].toLowerCase()).to.equal(addr0)
      expect(unclaimed.amounts[0]).to.equal(ethers.utils.parseEther('123'))
      expect(unclaimed.tokens[1].toLowerCase()).to.equal(addr1)
      expect(unclaimed.amounts[1]).to.equal(ethers.utils.parseEther('456'))
    })
  })
})

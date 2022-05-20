import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import {
  ICollateral,
  PerennialLens,
  PerennialLens__factory,
  IProduct,
  IProductProvider,
  IController,
} from '../../../types/generated'
import { expectPositionEq, expectPrePositionEq } from '../../testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('PerennialLens', () => {
  let user: SignerWithAddress
  let protocolTreasury: SignerWithAddress
  let productTreasury: SignerWithAddress
  let collateral: FakeContract<ICollateral>
  let product: FakeContract<IProduct>
  let productProvider: FakeContract<IProductProvider>
  let controller: FakeContract<IController>
  let lens: PerennialLens

  beforeEach(async () => {
    ;[user, protocolTreasury, productTreasury] = await ethers.getSigners()

    collateral = await smock.fake<ICollateral>('ICollateral')
    product = await smock.fake<IProduct>('IProduct')
    productProvider = await smock.fake<IProductProvider>('IProductProvider')
    controller = await smock.fake<IController>('IController')

    controller.collateral.returns(collateral.address)
    product.productProvider.returns(productProvider.address)

    lens = await new PerennialLens__factory(user).deploy(controller.address)
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      expect(await lens.controller()).to.equal(controller.address)
      expect(await lens['collateral()']()).to.equal(collateral.address)
    })
  })

  describe('#name', () => {
    it('returns the name of the product', async () => {
      productProvider.name.returns('MyProduct')
      expect(await lens.callStatic.name(product.address)).to.equal('MyProduct')
    })
  })

  describe('#symbol', () => {
    it('returns the symbol of the product', async () => {
      productProvider.symbol.returns('PROD')
      expect(await lens.callStatic.symbol(product.address)).to.equal('PROD')
    })
  })

  describe('#collateral(address,address)', () => {
    it('returns the user collateral amount after settle', async () => {
      collateral['collateral(address,address)'].whenCalledWith(user.address, product.address).returns(100)
      expect(await lens.callStatic['collateral(address,address)'](user.address, product.address)).to.equal(100)
      expect(product.settle).to.have.been.calledOnce
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
      product.maintenance.whenCalledWith(user.address).returns(10)
      product.maintenanceNext.whenCalledWith(user.address).returns(8)
      expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal(10)
      expect(product.settle).to.have.been.calledOnce
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })

    it('returns maintenanceNext if it is higher than maintenance', async () => {
      product.maintenance.whenCalledWith(user.address).returns(10)
      product.maintenanceNext.whenCalledWith(user.address).returns(15)
      expect(await lens.callStatic.maintenance(user.address, product.address)).to.equal(15)
      expect(product.settle).to.have.been.calledOnce
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#liquidatable', () => {
    it('returns whether or not the user is liquidatable after settle', async () => {
      collateral.liquidatable.whenCalledWith(user.address, product.address).returns(true)
      expect(await lens.callStatic.liquidatable(user.address, product.address)).to.equal(true)
      expect(product.settle).to.have.been.calledOnce
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
      expect(product.settle).to.have.been.calledOnce
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
      expect(product.settle).to.have.been.calledOnce
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
      expect(product.settle).to.have.been.calledOnce
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
      productProvider.currentVersion.returns(currVersion)
      expectPositionEq(await lens.callStatic['openInterest(address,address)'](user.address, product.address), {
        maker: 78900,
        taker: 0,
      })
      expect(product.settle).to.have.been.calledOnce
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
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
      productProvider.currentVersion.returns(currVersion)
      expectPositionEq(await lens.callStatic['openInterest(address)'](product.address), {
        maker: 157800,
        taker: 78900,
      })
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#price', () => {
    it('returns the price after settle', async () => {
      const currVersion = {
        version: 1,
        timestamp: 456,
        price: 789,
      }
      productProvider.currentVersion.returns(currVersion)
      expect(await lens.callStatic.price(product.address)).to.equal(789)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#rate', () => {
    it('returns the rate after settle', async () => {
      product['latestVersion()'].returns(100)
      product.positionAtVersion.whenCalledWith(100).returns({ maker: 200, taker: 100 })
      productProvider.rate.returns(12345)
      expect(await lens.callStatic.rate(product.address)).to.equal(12345)
      expect(product.settle).to.have.been.calledOnce
    })
  })

  describe('#dailyRate', () => {
    it('returns the rate after settle', async () => {
      product['latestVersion()'].returns(100)
      product.positionAtVersion.whenCalledWith(100).returns({ maker: 200, taker: 100 })
      productProvider.rate.returns(12345)
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
      productProvider.currentVersion.returns(currVersion)
      productProvider.maintenance.returns(ethers.utils.parseEther('0.5'))
      expect(
        await lens.callStatic.maintenanceRequired(user.address, product.address, ethers.utils.parseEther('123')),
      ).to.equal(48523)
      expect(product.settle).to.have.been.calledOnce
      expect(product.settleAccount).to.have.been.calledOnceWith(user.address)
    })
  })

  describe('#fees(product)', () => {
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

  describe('#fees(product[],account)', () => {
    it('returns the total fees after settling all products', async () => {
      const product2 = await smock.fake<IProduct>('IProduct')
      collateral.fees.whenCalledWith(user.address).returns(ethers.utils.parseEther('12345'))

      const fees = await lens.callStatic['fees(address,address[])'](user.address, [product.address, product2.address])
      expect(fees).to.equal(ethers.utils.parseEther('12345'))
      expect(product.settle).to.have.been.calledOnce
      expect(product2.settle).to.have.been.calledOnce
    })
  })
})

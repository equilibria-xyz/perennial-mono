import { expect } from 'chai'
import { BigNumber, utils } from 'ethers'
import 'hardhat'

import { InstanceVars, deployProtocol, createProduct } from '../helpers/setupHelpers'

describe('Forwarder', () => {
  let instanceVars: InstanceVars

  beforeEach(async () => {
    instanceVars = await deployProtocol()
  })

  it('deposits the USDC amount wrapped as DSU to the product account', async () => {
    const { user, userB, forwarder, dsu, usdc, usdcHolder, lens } = instanceVars

    const product = await createProduct(instanceVars)

    await usdc.connect(usdcHolder).transfer(user.address, 10e12)

    await usdc.connect(user).approve(forwarder.address, 10e12)

    await expect(forwarder.connect(user).wrapAndDeposit(userB.address, product.address, utils.parseEther('1000')))
      .to.emit(forwarder, 'WrapAndDeposit')
      .withArgs(userB.address, product.address, utils.parseEther('1000'))

    expect(await usdc.balanceOf(user.address)).to.equal(BigNumber.from(10e12).sub(1000e6))

    expect((await product.accounts(userB.address))._collateral).to.equal(utils.parseEther('1000').div(1e12))
    expect(await lens.callStatic['collateral(address)'](product.address)).to.equal(utils.parseEther('1000'))

    expect(await usdc.balanceOf(forwarder.address)).to.equal(0)
    expect(await dsu.balanceOf(forwarder.address)).to.equal(0)
  })
})

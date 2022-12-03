import { expect } from 'chai'
import { utils, constants } from 'ethers'
import HRE from 'hardhat'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { expectPositionEq } from '../../../../common/testutil/types'
import { Collateral, IERC20Metadata, Product } from '../../../types/generated'
import { setupTokenHolders } from '../../integration/helpers/setupHelpers'

const { ethers } = HRE

export default async function opensPositions(
  collateral: Collateral,
  dsu: IERC20Metadata,
  product: Product,
): Promise<void> {
  const timelockSigner = await impersonateWithBalance(
    '0xA20ea565cD799e01A86548af5a2929EB7c767fC9',
    utils.parseEther('10'),
  )
  const [, userA, userB] = await ethers.getSigners()
  const { dsuHolder } = await setupTokenHolders(dsu, [])
  await dsu.connect(dsuHolder).approve(collateral.address, constants.MaxUint256)
  await collateral.connect(dsuHolder).depositTo(userA.address, product.address, utils.parseEther('1000'))
  await collateral.connect(dsuHolder).depositTo(userB.address, product.address, utils.parseEther('1000'))

  await product.connect(timelockSigner).updateMakerLimit(utils.parseEther('100'))
  expect(await product.connect(userA).openMake(utils.parseEther('0.01'))).to.not.be.reverted
  expect(await product.connect(userB).openTake(utils.parseEther('0.01'))).to.not.be.reverted

  const pre = await product['pre()']()
  expectPositionEq(pre.openPosition, { maker: utils.parseEther('0.01'), taker: utils.parseEther('0.01') })
  expectPositionEq(pre.closePosition, { maker: 0, taker: 0 })
}

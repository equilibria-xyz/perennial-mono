import { expect } from 'chai'
import { utils, constants } from 'ethers'
import HRE from 'hardhat'
import { pushPrice } from '../../../../common/testutil/oracle'
import { expectPositionEq } from '../../../../common/testutil/types'
import {
  Collateral__factory,
  IEmptySetReserve__factory,
  IERC20Metadata__factory,
  Product,
} from '../../../types/generated'
import { setupTokenHolders } from '../../integration/helpers/setupHelpers'
import { Deployment } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '../../../../common/testutil'

const { ethers, config } = HRE

const POSITION = utils.parseEther('0.01')

export default async function opensPositions(
  product: Product,
  signer: SignerWithAddress,
  deployments: { [name: string]: Deployment },
  network: 'mainnet' | 'arbitrum' = 'mainnet',
  asset: 'eth' | 'arb' = 'eth',
): Promise<void> {
  await time.reset(config)

  const collateral = Collateral__factory.connect(deployments['Collateral_Proxy'].address, signer)
  const dsu = IERC20Metadata__factory.connect(deployments['DSU'].address, signer)
  const usdc = IERC20Metadata__factory.connect(deployments['USDC'].address, signer)
  const reserve = IEmptySetReserve__factory.connect(deployments['EmptysetReserve'].address, signer)

  const [, userA, userB] = await ethers.getSigners()
  const { dsuHolder } = await setupTokenHolders(dsu, usdc, reserve, [], network)

  await dsu.connect(dsuHolder).approve(collateral.address, constants.MaxUint256)
  await collateral.connect(dsuHolder).depositTo(userA.address, product.address, utils.parseEther('1000'))
  await collateral.connect(dsuHolder).depositTo(userB.address, product.address, utils.parseEther('1000'))

  await expect(product.connect(userA).openMake(POSITION)).to.not.be.reverted
  await expect(product.connect(userB).openTake(POSITION)).to.not.be.reverted

  const pre = await product['pre()']()
  expectPositionEq(pre.openPosition, { maker: POSITION, taker: POSITION })
  expectPositionEq(pre.closePosition, { maker: 0, taker: 0 })

  const latestVersion = await product['latestVersion()']()
  const latestPosition = await product.positionAtVersion(latestVersion)

  // Push new oracle price
  await pushPrice(network, asset)

  await expect(product.settle()).to.not.be.reverted
  const nextVersion = await product['latestVersion()']()

  expect(nextVersion).to.equal(latestVersion.add(1))
  expectPositionEq(await product.positionAtVersion(nextVersion), {
    maker: POSITION.add(latestPosition.maker),
    taker: POSITION.add(latestPosition.taker),
  })

  await expect(product.settleAccount(userA.address)).to.not.be.reverted
  expect(await product['latestVersion(address)'](userA.address)).to.equal(nextVersion)
  expectPositionEq(await product.position(userA.address), { maker: POSITION, taker: 0 })

  await expect(product.settleAccount(userB.address)).to.not.be.reverted
  expect(await product['latestVersion(address)'](userB.address)).to.equal(nextVersion)
  expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION })

  await expect(collateral.connect(userA).withdrawTo(userA.address, product.address, utils.parseEther('10'))).to.not.be
    .reverted
  await expect(collateral.connect(userB).withdrawTo(userB.address, product.address, utils.parseEther('10'))).to.not.be
    .reverted
}

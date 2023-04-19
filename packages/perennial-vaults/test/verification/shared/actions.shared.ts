import { expect } from 'chai'
import { constants, utils } from 'ethers'
import HRE from 'hardhat'
import { pushPrice } from '../../../../common/testutil/oracle'
import { BalancedVault, IEmptySetReserve__factory, IERC20Metadata__factory } from '../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Deployment } from 'hardhat-deploy/types'
import { setupTokenHolders } from '../../../../common/testutil/impersonate'

const { ethers } = HRE

export async function expectVaultDeposit(
  vault: BalancedVault,
  signer: SignerWithAddress,
  deployments: { [name: string]: Deployment },
  network: 'mainnet' | 'arbitrum' = 'mainnet',
  assets: Array<'eth' | 'arb'> = ['eth'],
): Promise<void> {
  const dsu = IERC20Metadata__factory.connect(deployments['DSU'].address, signer)
  const usdc = IERC20Metadata__factory.connect(deployments['USDC'].address, signer)
  const reserve = IEmptySetReserve__factory.connect(deployments['EmptysetReserve'].address, signer)

  const [, userA, userB] = await ethers.getSigners()
  const { dsuHolder } = await setupTokenHolders(dsu, usdc, reserve, [], network)

  await dsu.connect(dsuHolder).approve(vault.address, constants.MaxUint256)
  await vault.connect(dsuHolder).deposit(utils.parseEther('1000'), userA.address)
  await vault.connect(dsuHolder).deposit(utils.parseEther('1000'), userB.address)

  const currentEpoch = await vault.currentEpoch()

  // Push new oracle price
  await Promise.all(assets.map(asset => pushPrice(network, asset)))

  await vault.sync()
  const nextEpoch = await vault.currentEpoch()

  expect(nextEpoch).to.equal(currentEpoch.add(1))
  const expectedBalance = await vault.convertToShares(utils.parseEther('1000'))
  expect(await vault.balanceOf(userA.address)).to.equal(expectedBalance)
  expect(await vault.balanceOf(userB.address)).to.equal(expectedBalance)
}

export async function expectVaultRedeemAndClaim(
  vault: BalancedVault,
  signer: SignerWithAddress,
  user: SignerWithAddress,
  deployments: { [name: string]: Deployment },
  network: 'mainnet' | 'arbitrum' = 'mainnet',
  assets: Array<'eth' | 'arb'> = ['eth'],
): Promise<void> {
  const dsu = IERC20Metadata__factory.connect(deployments['DSU'].address, signer)

  const currentEpoch = await vault.currentEpoch()
  const currentDSUBalance = await dsu.balanceOf(user.address)
  const currentBalance = await vault.balanceOf(user.address)
  await vault.connect(user).redeem(currentBalance, user.address)

  // Push new oracle price
  await Promise.all(assets.map(asset => pushPrice(network, asset)))

  await vault.sync()
  const nextEpoch = await vault.currentEpoch()

  expect(nextEpoch).to.equal(currentEpoch.add(1))
  expect(await vault.balanceOf(user.address)).to.equal(0)

  const expectedDSUReceived = await vault.convertToAssets(currentBalance)
  expect(await vault.unclaimed(user.address)).to.equal(expectedDSUReceived)

  await vault.connect(user).claim(user.address)
  expect(await dsu.balanceOf(user.address)).to.equal(currentDSUBalance.add(expectedDSUReceived))
}

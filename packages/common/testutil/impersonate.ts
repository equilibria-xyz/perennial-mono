import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish, constants, Contract, utils } from 'ethers'
import HRE from 'hardhat'
const { ethers } = HRE

export const DSU_HOLDER = {
  mainnet: '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997',
  arbitrum: '',
}
export const USDC_HOLDER = {
  mainnet: '0x0A59649758aa4d66E25f08Dd01271e891fe52199',
  arbitrum: '0x8b8149dd385955dc1ce77a4be7700ccd6a212e65',
}

export async function impersonate(address: string): Promise<SignerWithAddress> {
  await HRE.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })
  return ethers.getSigner(address)
}

export async function impersonateWithBalance(address: string, balance: BigNumberish): Promise<SignerWithAddress> {
  await HRE.network.provider.request({
    method: 'hardhat_setBalance',
    // Replace is necessary because leading 0s are not allowed
    params: [address, BigNumber.from(balance).toHexString().replace('0x0', '0x')],
  })
  await HRE.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })
  return ethers.getSigner(address)
}

export async function setupTokenHolders(
  dsu: Contract,
  usdc: Contract,
  reserve: Contract,
  users: SignerWithAddress[],
  network: 'mainnet' | 'arbitrum' = 'mainnet',
): Promise<{ dsuHolder: SignerWithAddress; usdcHolder: SignerWithAddress }> {
  const usdcHolderAddress = USDC_HOLDER[network]
  const dsuHolderAddress = DSU_HOLDER[network] || usdcHolderAddress
  const usdcHolder = await impersonateWithBalance(usdcHolderAddress, utils.parseEther('10'))
  const dsuHolder = await impersonateWithBalance(dsuHolderAddress, utils.parseEther('10'))

  await usdc.connect(usdcHolder).approve(reserve.address, constants.MaxUint256)
  await reserve.connect(usdcHolder).mint(utils.parseEther('1000000'))
  await dsu.connect(usdcHolder).transfer(dsuHolder.address, utils.parseEther('1000000'))

  await Promise.all(
    users.map(async user => {
      await dsu.connect(dsuHolder).transfer(user.address, utils.parseEther('20000'))
    }),
  )

  return { dsuHolder, usdcHolder }
}

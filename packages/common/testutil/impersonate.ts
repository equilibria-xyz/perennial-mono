import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish } from 'ethers'
import HRE from 'hardhat'
const { ethers } = HRE

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

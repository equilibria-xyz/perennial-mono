import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
const { ethers } = HRE

export async function nextContractAddress(address: SignerWithAddress, nonceOffset?: number): Promise<string> {
  const transactionCount = await address.getTransactionCount()
  return ethers.utils.getContractAddress({
    from: address.address,
    nonce: transactionCount + (nonceOffset || 0),
  })
}

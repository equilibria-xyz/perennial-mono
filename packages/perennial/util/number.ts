import { BigNumber, ethers } from 'ethers'

export function parse6decimal(amount: string): BigNumber {
  return ethers.utils.parseEther(amount).div(1e12)
}

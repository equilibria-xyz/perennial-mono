import HRE from 'hardhat'
import { impersonate } from '../../../common/testutil'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IController,
  IController__factory,
  IProduct,
  IProduct__factory,
  PerennialBalancedVault,
  PerennialBalancedVault__factory,
} from '../../types/generated'
import { utils } from 'ethers'
const { ethers } = HRE

const DSU_HOLDER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'

describe('BalancedVault', () => {
  let vault: PerennialBalancedVault
  let asset: IERC20Metadata
  let owner: SignerWithAddress
  let user: SignerWithAddress

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    const dsu = IERC20Metadata__factory.connect('0x605D26FBd5be761089281d5cec2Ce86eeA667109', owner)
    const controller = IController__factory.connect('0x9df509186b6d3b7D033359f94c8b1BB5544d51b3', owner)
    const long = IProduct__factory.connect('0xdB60626FF6cDC9dB07d3625A93d21dDf0f8A688C', owner)
    const short = IProduct__factory.connect('0xfeD3E166330341e0305594B8c6e6598F9f4Cbe9B', owner)

    vault = await new PerennialBalancedVault__factory(owner).deploy(
      dsu.address,
      controller.address,
      long.address,
      short.address,
      utils.parseEther('1'),
      utils.parseEther('10000'),
      utils.parseEther('1.1'),
    )
    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

    const dsuHolder = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    await dsu.connect(dsuHolder).transfer(user.address, utils.parseEther('200000'))
    await dsu.connect(user).approve(vault.address, utils.parseEther('2000000000'))
  })

  it('deposits successfully', async () => {
    await vault.connect(user).deposit(utils.parseEther('10'), user.address)
    console.log((await asset.connect(user).balanceOf(user.address)).toString())
  })
})

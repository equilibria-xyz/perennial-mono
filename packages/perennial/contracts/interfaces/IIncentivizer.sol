// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "./types/ProgramInfo.sol";
import "./IOracleProvider.sol";
import "./IController.sol";
import "./IProduct.sol";

interface IIncentivizer {
    event ProgramCompleted(uint256 indexed programId, uint256 versionComplete);
    event ProgramClosed(uint256 indexed programId, UFixed18 amount);
    event ProgramCreated(uint256 indexed programId, IProduct product, Token18 token, UFixed18 amountMaker, UFixed18 amountTaker, uint256 start, uint256 duration, uint256 grace, UFixed18 fee);
    event Claim(address indexed account, uint256 indexed programId, UFixed18 amount);
    event FeeClaim(Token18 indexed token, UFixed18 amount);

    error IncentivizerProgramNotClosableError();
    error IncentivizerTooManyProgramsError();
    error IncentivizerProgramPausedError(uint256 programId);
    error IncentivizerNotProgramOwnerError(uint256 programId);
    error IncentivizerInvalidProgramError(uint256 programId);

    function programInfos(uint256 programId) external view returns (ProgramInfo memory);
    function fees(Token18 token) external view returns (UFixed18);
    function initialize(IController controller_) external;
    function create(ProgramInfo calldata info) external returns (uint256);
    function end(uint256 programId) external;
    function close(uint256 programId) external;
    function sync(IOracleProvider.OracleVersion memory currentOracleVersion) external;
    function syncAccount(address account, Accumulator memory userShareDelta, IOracleProvider.OracleVersion memory currentOracleVersion) external;
    function claim(IProduct product) external;
    function claim(uint256 programId) external;
    function claimFee(Token18[] calldata tokens) external;
    function unclaimed(address account, uint256 programId) external view returns (UFixed18);
    function latestVersion(address account, uint256 programId) external view returns (uint256);
    function settled(address account, uint256 programId) external view returns (UFixed18);
    function available(uint256 programId) external view returns (UFixed18);
    function versionComplete(uint256 programId) external view returns (uint256);
    function closed(uint256 programId) external view returns (bool);
    function programsForLength(IProduct product) external view returns (uint256);
    function programsForAt(IProduct product, uint256 index) external view returns (uint256);
    function owner(uint256 programId) external view returns (address);
    function treasury(uint256 programId) external view returns (address);
}

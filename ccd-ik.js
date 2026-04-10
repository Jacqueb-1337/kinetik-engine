/**
 * CCD IK Solver for Three.js - Bundled Version
 * Based on IKSolver-for-threejs by pinglu85
 * https://github.com/pinglu85/IKSolver-for-threejs
 */

import { Group, Vector3, Quaternion } from 'three';

// AXIS_NAMES constants
const AXIS_NAMES = {
  X: 'x',
  Y: 'y',
  Z: 'z',
};

// IKJoint class
class IKJoint extends Group {
  constructor(urdfJoint = null) {
    super();
    this.position.set(0, 0, 0);
    this.axis = new Vector3(0, 1, 0);
    this.isRootJoint = true;
    this.isHinge = false;
    this.isFixed = false;
    this.isIkJoint = true;
    this.limit = { lower: 0, upper: 0 };

    if (urdfJoint) {
      this.position.copy(urdfJoint.position);
      this.rotation.copy(urdfJoint.rotation);
      this.isRootJoint = false;
      this.isHinge = urdfJoint.jointType === 'revolute';
      this.isFixed = urdfJoint.jointType === 'fixed';
      this.axis.copy(urdfJoint.axis);
      this.limit = {
        ...urdfJoint.limit,
      };
    }
  }

  get axisArray() {
    return this.axis.toArray();
  }

  get axisIdx() {
    return this.axisArray.findIndex((value) => value !== 0);
  }

  get axisName() {
    switch (this.axisIdx) {
      case 0:
        return AXIS_NAMES.X;
      case 1:
        return AXIS_NAMES.Y;
      case 2:
        return AXIS_NAMES.Z;
      default:
        return '';
    }
  }

  get axisIsNegative() {
    return this.axisArray[this.axisIdx] < 0;
  }
}

// IKChain class (simplified for basic usage)
class IKChain {
  constructor() {
    this.ikJoints = [];
    this.endEffector = null;
    this.rootJoint = null;
  }

  addJoint(joint) {
    this.ikJoints.push(joint);
  }

  setEndEffector(effector) {
    this.endEffector = effector;
  }

  setRootJoint(joint) {
    this.rootJoint = joint;
  }
}

// CCD IK Solver algorithm
const endEffectorWorldPosition = new Vector3();
const endEffectorWorldToLocalPosition = new Vector3();
const targetWorldToLocalPosition = new Vector3();
const fromToQuaternion = new Quaternion();
const inverseQuaternion = new Quaternion();
const jointAxisAfterRotation = new Vector3();

function ccdIKSolver(ikChain, targetPosition, tolerance = 0.01, maxNumOfIterations = 100) {
  const { ikJoints, endEffector } = ikChain;

  if (!endEffector || !ikJoints.length) {
    console.warn('CCD IK Solver: Invalid chain setup');
    return false;
  }

  let endEffectorTargetDistance = endEffector
    .worldToLocal(targetWorldToLocalPosition.copy(targetPosition))
    .length();
  let numOfIterations = 0;

  while (
    endEffectorTargetDistance > tolerance &&
    numOfIterations <= maxNumOfIterations
  ) {
    for (let idx = ikJoints.length - 1; idx >= 0; idx--) {
      const ikJoint = ikJoints[idx];
      
      if (ikJoint.isFixed) {
        ikJoint.updateMatrixWorld();
        continue;
      }

      endEffector.getWorldPosition(endEffectorWorldPosition);

      // Get direction from joint to end effector
      const directionToEndEffector = ikJoint
        .worldToLocal(
          endEffectorWorldToLocalPosition.copy(endEffectorWorldPosition)
        )
        .normalize();

      // Get direction from joint to target
      const directionToTarget = ikJoint
        .worldToLocal(targetWorldToLocalPosition.copy(targetPosition))
        .normalize();

      // Calculate rotation to align end effector with target
      fromToQuaternion.setFromUnitVectors(
        directionToEndEffector,
        directionToTarget
      );
      ikJoint.quaternion.multiply(fromToQuaternion);

      // Constrain to hinge axis if needed
      if (ikJoint.isHinge || ikJoint.isRootJoint) {
        inverseQuaternion.copy(ikJoint.quaternion).invert();
        jointAxisAfterRotation
          .copy(ikJoint.axis)
          .applyQuaternion(inverseQuaternion);

        fromToQuaternion.setFromUnitVectors(
          ikJoint.axis,
          jointAxisAfterRotation
        );
        ikJoint.quaternion.multiply(fromToQuaternion);
      }

      // Apply rotation limits if they exist
      if (ikJoint.limit && (ikJoint.limit.lower !== 0 || ikJoint.limit.upper !== 0)) {
        const ikJointRotationAngle = getIKJointRotationAngle(ikJoint);
        const [clampedAngle, isClamped] = clampIKJointRotationAngle(
          ikJointRotationAngle,
          ikJoint.limit
        );

        if (isClamped) {
          ikJoint.quaternion.setFromAxisAngle(
            ikJoint.axis,
            clampedAngle
          );
        }
      }

      ikJoint.updateMatrixWorld();
    }

    endEffectorTargetDistance = endEffector
      .worldToLocal(targetWorldToLocalPosition.copy(targetPosition))
      .length();
    numOfIterations++;
  }

  return endEffectorTargetDistance <= tolerance;
}
function getIKJointRotationAngle(ikJoint) {
  const { axisIdx, axis } = ikJoint;
  // Extract rotation angle from quaternion based on axis
  // For rotation around axis, use quaternion components
  const q = ikJoint.quaternion;
  const qArray = [q.x, q.y, q.z, q.w];
  
  if (axisIdx < 0 || axisIdx > 2) return 0;
  
  const axisValue = axis.getComponent(axisIdx);
  if (Math.abs(axisValue) < 0.0001) return 0;
  
  return Math.asin(qArray[axisIdx] / axisValue) * 2;
}

function clampIKJointRotationAngle(angle, limit) {
  const { lower, upper } = limit;
  let isClamped = false;
  
  if (angle < lower) {
    return [lower, true];
  }
  if (angle > upper) {
    return [upper, true];
  }
  return [angle, false];
}

// Export public API
export { IKChain, IKJoint, ccdIKSolver, AXIS_NAMES };
export default ccdIKSolver;

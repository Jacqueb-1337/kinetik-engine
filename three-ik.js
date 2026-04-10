import * as three from 'three';

var t1 = new three.Vector3();
var t2 = new three.Vector3();
var t3 = new three.Vector3();
var m1 = new three.Matrix4();
function getWorldPosition(object, target) {
  return target.setFromMatrixPosition(object.matrixWorld);
}

function getCentroid(positions, target) {
  target.set(0, 0, 0);
  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;
  try {
    for (var _iterator = positions[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var position = _step.value;
      target.add(position);
    }
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion && _iterator.return) {
        _iterator.return();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }
  target.divideScalar(positions.length);
  return target;
}

function setQuaternionFromDirection(direction, up, target) {
  var x = t1;
  var y = t2;
  var z = t3;
  var m = m1;
  var el = m1.elements;
  z.copy(direction);
  x.crossVectors(up, z);
  if (x.lengthSq() === 0) {
    if (Math.abs(up.z) === 1) {
      z.x += 0.0001;
    } else {
      z.z += 0.0001;
    }
    z.normalize();
    x.crossVectors(up, z);
  }
  x.normalize();
  y.crossVectors(z, x);
  el[0] = x.x;el[4] = y.x;el[8] = z.x;
  el[1] = x.y;el[5] = y.y;el[9] = z.y;
  el[2] = x.z;el[6] = y.z;el[10] = z.z;
  target.setFromRotationMatrix(m);
}

function transformPoint(vector, matrix, target) {
  var e = matrix.elements;
  var x = vector.x * e[0] + vector.y * e[4] + vector.z * e[8] + e[12];
  var y = vector.x * e[1] + vector.y * e[5] + vector.z * e[9] + e[13];
  var z = vector.x * e[2] + vector.y * e[6] + vector.z * e[10] + e[14];
  var w = vector.x * e[3] + vector.y * e[7] + vector.z * e[11] + e[15];
  target.set(x / w, y / w, z / w);
}

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
  return typeof obj;
} : function (obj) {
  return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
};

var classCallCheck = function (instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
};

var createClass = function () {
  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  return function (Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps);
    return Constructor;
  };
}();

var get = function get(object, property, receiver) {
  if (object === null) object = Function.prototype;
  var desc = Object.getOwnPropertyDescriptor(object, property);
  if (desc === undefined) {
    var parent = Object.getPrototypeOf(object);
    if (parent === null) {
      return undefined;
    } else {
      return get(parent, property, receiver);
    }
  } else if ("value" in desc) {
    return desc.value;
  } else {
    var getter = desc.get;
    if (getter === undefined) {
      return undefined;
    }
    return getter.call(receiver);
  }
};

var inherits = function (subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
  }
  subClass.prototype = Object.create(superClass && superClass.prototype, {
    constructor: {
      value: subClass,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
  if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
};

var possibleConstructorReturn = function (self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }
  return call && (typeof call === "object" || typeof call === "function") ? call : self;
};

var slicedToArray = function () {
  function sliceIterator(arr, i) {
    var _arr = [];
    var _n = true;
    var _d = false;
    var _e = undefined;
    try {
      for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
        _arr.push(_s.value);
        if (i && _arr.length === i) break;
      }
    } catch (err) {
      _d = true;
      _e = err;
    } finally {
      try {
        if (!_n && _i["return"]) _i["return"]();
      } finally {
        if (_d) throw _e;
      }
    }
    return _arr;
  }
  return function (arr, i) {
    if (Array.isArray(arr)) {
      return arr;
    } else if (Symbol.iterator in Object(arr)) {
      return sliceIterator(arr, i);
    } else {
      throw new TypeError("Invalid attempt to destructure non-iterable instance");
    }
  };
}();

var Z_AXIS = new three.Vector3(0, 0, 1);
var DEG2RAD = Math.PI / 180;
var RAD2DEG = 180 / Math.PI;

var IKBallConstraint = function () {
  function IKBallConstraint(angle) {
    classCallCheck(this, IKBallConstraint);
    this.angle = angle;
  }

  createClass(IKBallConstraint, [{
    key: '_apply',
    value: function _apply(joint) {
      var direction = new three.Vector3().copy(joint._getDirection());
      var parentDirection = joint._localToWorldDirection(new three.Vector3().copy(Z_AXIS)).normalize();
      var currentAngle = direction.angleTo(parentDirection) * RAD2DEG;
      if (this.angle / 2 < currentAngle) {
        direction.normalize();
        var correctionAxis = new three.Vector3().crossVectors(parentDirection, direction).normalize();
        parentDirection.applyAxisAngle(correctionAxis, this.angle * DEG2RAD * 0.5);
        joint._setDirection(parentDirection);
        return true;
      }
      return false;
    }
  }]);
  return IKBallConstraint;
}();

var Y_AXIS = new three.Vector3(0, 1, 0);

var IKJoint = function () {
  function IKJoint(bone) {
    var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
        constraints = _ref.constraints;
    classCallCheck(this, IKJoint);
    this.constraints = constraints || [];
    this.bone = bone;
    this.distance = 0;
    this._originalDirection = new three.Vector3();
    this._direction = new three.Vector3();
    this._worldPosition = new three.Vector3();
    this._isSubBase = false;
    this._subBasePositions = null;
    this.isIKJoint = true;
    this._updateWorldPosition();
  }

  createClass(IKJoint, [{
    key: '_setIsSubBase',
    value: function _setIsSubBase() {
      this._isSubBase = true;
      this._subBasePositions = [];
    }
  }, {
    key: '_applySubBasePositions',
    value: function _applySubBasePositions() {
      if (this._subBasePositions.length === 0) {
        return;
      }
      getCentroid(this._subBasePositions, this._worldPosition);
      this._subBasePositions.length = 0;
    }
  }, {
    key: '_applyConstraints',
    value: function _applyConstraints() {
      if (!this.constraints) {
        return;
      }
      var constraintApplied = false;
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;
      try {
        for (var _iterator = this.constraints[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var constraint = _step.value;
          if (constraint && constraint._apply) {
            var applied = constraint._apply(this);
            constraintApplied = constraintApplied || applied;
          }
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }
      return constraintApplied;
    }
  }, {
    key: '_setDistance',
    value: function _setDistance(distance) {
      this.distance = distance;
    }
  }, {
    key: '_getDirection',
    value: function _getDirection() {
      return this._direction;
    }
  }, {
    key: '_setDirection',
    value: function _setDirection(direction) {
      this._direction.copy(direction);
    }
  }, {
    key: '_getDistance',
    value: function _getDistance() {
      return this.distance;
    }
  }, {
    key: '_updateMatrixWorld',
    value: function _updateMatrixWorld() {
      this.bone.updateMatrixWorld(true);
    }
  }, {
    key: '_getWorldPosition',
    value: function _getWorldPosition() {
      return this._worldPosition;
    }
  }, {
    key: '_getWorldDirection',
    value: function _getWorldDirection(joint) {
      return new three.Vector3().subVectors(this._getWorldPosition(), joint._getWorldPosition()).normalize();
    }
  }, {
    key: '_updateWorldPosition',
    value: function _updateWorldPosition() {
      getWorldPosition(this.bone, this._worldPosition);
    }
  }, {
    key: '_setWorldPosition',
    value: function _setWorldPosition(position) {
      this._worldPosition.copy(position);
    }
  }, {
    key: '_localToWorldDirection',
    value: function _localToWorldDirection(direction) {
      if (this.bone.parent) {
        var parent = this.bone.parent.matrixWorld;
        direction.transformDirection(parent);
      }
      return direction;
    }
  }, {
    key: '_worldToLocalDirection',
    value: function _worldToLocalDirection(direction) {
      if (this.bone.parent) {
        var inverseParent = new three.Matrix4().copy(this.bone.parent.matrixWorld).invert();
        direction.transformDirection(inverseParent);
      }
      return direction;
    }
  }, {
    key: '_applyWorldPosition',
    value: function _applyWorldPosition() {
      var direction = new three.Vector3().copy(this._direction);
      var position = new three.Vector3().copy(this._getWorldPosition());
      var parent = this.bone.parent;
      if (parent) {
        this._updateMatrixWorld();
        var inverseParent = new three.Matrix4().copy(this.bone.parent.matrixWorld).invert();
        transformPoint(position, inverseParent, position);
        this.bone.position.copy(position);
        this._updateMatrixWorld();
        this._worldToLocalDirection(direction);
        setQuaternionFromDirection(direction, Y_AXIS, this.bone.quaternion);
      } else {
        this.bone.position.copy(position);
      }
      this.bone.updateMatrix();
      this._updateMatrixWorld();
    }
  }, {
    key: '_getWorldDistance',
    value: function _getWorldDistance(joint) {
      return this._worldPosition.distanceTo(joint.isIKJoint ? joint._getWorldPosition() : getWorldPosition(joint, new three.Vector3()));
    }
  }]);
  return IKJoint;
}();

var IKChain = function () {
  function IKChain() {
    classCallCheck(this, IKChain);
    this.isIKChain = true;
    this.totalLengths = 0;
    this.base = null;
    this.effector = null;
    this.effectorIndex = null;
    this.chains = new Map();
    this.origin = null;
    this.iterations = 100;
    this.tolerance = 0.01;
    this._depth = -1;
    this._targetPosition = new three.Vector3();
  }

  createClass(IKChain, [{
    key: 'add',
    value: function add(joint) {
      var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          target = _ref.target;
      if (this.effector) {
        throw new Error('Cannot add additional joints to a chain with an end effector.');
      }
      if (!joint.isIKJoint) {
        if (joint.isBone) {
          joint = new IKJoint(joint);
        } else {
          throw new Error('Invalid joint in an IKChain. Must be an IKJoint or a THREE.Bone.');
        }
      }
      this.joints = this.joints || [];
      this.joints.push(joint);
      if (this.joints.length === 1) {
        this.base = this.joints[0];
        this.origin = new three.Vector3().copy(this.base._getWorldPosition());
      } else {
        var previousJoint = this.joints[this.joints.length - 2];
        previousJoint._updateMatrixWorld();
        previousJoint._updateWorldPosition();
        joint._updateWorldPosition();
        var distance = previousJoint._getWorldDistance(joint);
        if (distance === 0) {
          throw new Error('bone with 0 distance between adjacent bone found');
        }
        joint._setDistance(distance);
        joint._updateWorldPosition();
        var direction = previousJoint._getWorldDirection(joint);
        previousJoint._originalDirection = new three.Vector3().copy(direction);
        joint._originalDirection = new three.Vector3().copy(direction);
        this.totalLengths += distance;
      }
      if (target) {
        this.effector = joint;
        this.effectorIndex = joint;
        this.target = target;
      }
      return this;
    }
  }, {
    key: '_hasEffector',
    value: function _hasEffector() {
      return !!this.effector;
    }
  }, {
    key: '_getDistanceFromTarget',
    value: function _getDistanceFromTarget() {
      return this._hasEffector() ? this.effector._getWorldDistance(this.target) : -1;
    }
  }, {
    key: 'connect',
    value: function connect(chain) {
      if (!chain.isIKChain) {
        throw new Error('Invalid connection in an IKChain. Must be an IKChain.');
      }
      if (!chain.base.isIKJoint) {
        throw new Error('Connecting chain does not have a base joint.');
      }
      var index = this.joints.indexOf(chain.base);
      if (this.target && index === this.joints.length - 1) {
        throw new Error('Cannot append a chain to an end joint in a chain with a target.');
      }
      if (index === -1) {
        throw new Error('Cannot connect chain that does not have a base joint in parent chain.');
      }
      this.joints[index]._setIsSubBase();
      var chains = this.chains.get(index);
      if (!chains) {
        chains = [];
        this.chains.set(index, chains);
      }
      chains.push(chain);
      return this;
    }
  }, {
    key: '_updateJointWorldPositions',
    value: function _updateJointWorldPositions() {
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;
      try {
        for (var _iterator = this.joints[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var joint = _step.value;
          joint._updateWorldPosition();
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }
    }
  }, {
    key: '_forward',
    value: function _forward() {
      this.origin.copy(this.base._getWorldPosition());
      if (this.target) {
        this._targetPosition.setFromMatrixPosition(this.target.matrixWorld);
        this.effector._setWorldPosition(this._targetPosition);
      } else if (!this.joints[this.joints.length - 1]._isSubBase) {
        return;
      }
      for (var i = 1; i < this.joints.length; i++) {
        var joint = this.joints[i];
        if (joint._isSubBase) {
          joint._applySubBasePositions();
        }
      }
      for (var _i = this.joints.length - 1; _i > 0; _i--) {
        var _joint = this.joints[_i];
        var prevJoint = this.joints[_i - 1];
        var direction = prevJoint._getWorldDirection(_joint);
        var worldPosition = direction.multiplyScalar(_joint.distance).add(_joint._getWorldPosition());
        if (prevJoint === this.base && this.base._isSubBase) {
          this.base._subBasePositions.push(worldPosition);
        } else {
          prevJoint._setWorldPosition(worldPosition);
        }
      }
    }
  }, {
    key: '_backward',
    value: function _backward() {
      if (!this.base._isSubBase) {
        this.base._setWorldPosition(this.origin);
      }
      for (var i = 0; i < this.joints.length - 1; i++) {
        var joint = this.joints[i];
        var nextJoint = this.joints[i + 1];
        var jointWorldPosition = joint._getWorldPosition();
        var direction = nextJoint._getWorldDirection(joint);
        joint._setDirection(direction);
        joint._applyConstraints();
        direction.copy(joint._direction);
        if (!(this.base === joint && joint._isSubBase)) {
          joint._applyWorldPosition();
        }
        nextJoint._setWorldPosition(direction.multiplyScalar(nextJoint.distance).add(jointWorldPosition));
        if (i === this.joints.length - 2) {
          if (nextJoint !== this.effector) {
            nextJoint._setDirection(direction);
          }
          nextJoint._applyWorldPosition();
        }
      }
      return this._getDistanceFromTarget();
    }
  }]);
  return IKChain;
}();

var IK = function () {
  function IK() {
    classCallCheck(this, IK);
    this.chains = [];
    this._needsRecalculated = true;
    this.isIK = true;
    this._orderedChains = null;
  }

  createClass(IK, [{
    key: 'add',
    value: function add(chain) {
      if (!chain.isIKChain) {
        throw new Error('Argument is not an IKChain.');
      }
      this.chains.push(chain);
    }
  }, {
    key: 'recalculate',
    value: function recalculate() {
      this._orderedChains = [];
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;
      try {
        for (var _iterator = this.chains[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var rootChain = _step.value;
          var orderedChains = [];
          this._orderedChains.push(orderedChains);
          var chainsToSave = [rootChain];
          while (chainsToSave.length) {
            var chain = chainsToSave.shift();
            orderedChains.push(chain);
            var _iteratorNormalCompletion2 = true;
            var _didIteratorError2 = false;
            var _iteratorError2 = undefined;
            try {
              for (var _iterator2 = chain.chains.values()[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                var subChains = _step2.value;
                var _iteratorNormalCompletion3 = true;
                var _didIteratorError3 = false;
                var _iteratorError3 = undefined;
                try {
                  for (var _iterator3 = subChains[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
                    var subChain = _step3.value;
                    if (chainsToSave.indexOf(subChain) !== -1) {
                      throw new Error('Recursive chain structure detected.');
                    }
                    chainsToSave.push(subChain);
                  }
                } catch (err) {
                  _didIteratorError3 = true;
                  _iteratorError3 = err;
                } finally {
                  try {
                    if (!_iteratorNormalCompletion3 && _iterator3.return) {
                      _iterator3.return();
                    }
                  } finally {
                    if (_didIteratorError3) {
                      throw _iteratorError3;
                    }
                  }
                }
              }
            } catch (err) {
              _didIteratorError2 = true;
              _iteratorError2 = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion2 && _iterator2.return) {
                  _iterator2.return();
                }
              } finally {
                if (_didIteratorError2) {
                  throw _iteratorError2;
                }
              }
            }
          }
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }
    }
  }, {
    key: 'solve',
    value: function solve() {
      if (!this._orderedChains) {
        this.recalculate();
      }
      var _iteratorNormalCompletion4 = true;
      var _didIteratorError4 = false;
      var _iteratorError4 = undefined;
      try {
        for (var _iterator4 = this._orderedChains[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
          var subChains = _step4.value;
          var iterations = 1;
          while (iterations > 0) {
            for (var i = subChains.length - 1; i >= 0; i--) {
              subChains[i]._updateJointWorldPositions();
            }
            for (var _i = subChains.length - 1; _i >= 0; _i--) {
              subChains[_i]._forward();
            }
            var withinTolerance = true;
            for (var _i2 = 0; _i2 < subChains.length; _i2++) {
              var distanceFromTarget = subChains[_i2]._backward();
              if (distanceFromTarget > this.tolerance) {
                withinTolerance = false;
              }
            }
            if (withinTolerance) {
              break;
            }
            iterations--;
          }
        }
      } catch (err) {
        _didIteratorError4 = true;
        _iteratorError4 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion4 && _iterator4.return) {
            _iterator4.return();
          }
        } finally {
          if (_didIteratorError4) {
            throw _iteratorError4;
          }
        }
      }
    }
  }, {
    key: 'getRootBone',
    value: function getRootBone() {
      return this.chains[0].base.bone;
    }
  }]);
  return IK;
}();

export { IK, IKChain, IKJoint, IKBallConstraint };

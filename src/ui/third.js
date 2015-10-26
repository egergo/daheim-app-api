import LocalheimClient from './localheim/localheim_client';
import NavigationGuard from './navigation_guard';
import {default as Ozora, WhitelistReceiver} from '../ozora';
import screenfull from 'screenfull';
import createDebug from 'debug';
let debug = createDebug('dhm:third');


let app = window.angular.module('dhm');

app.config(function($routeProvider) {
	$routeProvider
		.when('/third', {
			templateUrl: 'partials/third.html',
			controller: 'ThirdCtrl'
		});
});

app.config(function($mdThemingProvider) {
	console.log('theming', $mdThemingProvider);
	$mdThemingProvider
		.theme('video')
		.dark()
		.backgroundPalette('grey', {
			default: '900'
		});
});

app.directive('dhmSizeWatcher', function() {
	return {
		restrict: 'A',
		link: ($scope, $element, attributes) => {
			let watcherFn = () => { return {w: $element.width(), h: $element.height()}; };
			$scope.$watch(watcherFn, function(value) {
				if (!value) { return; }
				$scope[attributes.dhmSizeWatcher] = value;
			}, true);

			let handler = () => $scope.$apply();
			$element.on('resize', handler);
			$scope.$on('$destroy', () => $element.off('resize', handler));
		}
	};
});

app.directive('dhmCenter', function() {
	return {
		restrict: 'A',
		link: ($scope, $element, attributes) => {

			$element.css('position', 'absolute');

			function check() {
				return {
					w: $element.outerWidth(),
					h: $element.outerHeight(),
					pw: $element.parent().width(),
					ph: $element.parent().height()
				};
			}

			$scope.$watch(check, value => {
				if (!value) { return; }
				let left = Math.floor((value.pw - value.w) / 2);
				let top = Math.floor((value.ph - value.h) / 2);

				$element.css('left', '' + left + 'px');
				$element.css('top', '' + top + 'px');
			}, true);

			let handler = () => $scope.$apply();
			$element.on('resize', handler);
			$scope.$on('$destroy', () => $element.off('resize', handler));
			$element.parent().on('resize', handler);
			$scope.$on('$destroy', () => $element.parent().off('resize', handler));
		}
	};
});

app.directive('dhmMaxVideoSize', function() {
	return {
		restrict: 'A',
		link: ($scope, $element, attributes) => {
			$scope.$watch(attributes.dhmMaxVideoSize, value => {
				setSize();
			});

			function setSize() {
				let max = $scope.$eval(attributes.dhmMaxVideoSize);
				if (!max || !max.h || !max.w) { return; }

				let vw = $element[0].videoWidth;
				let vh = $element[0].videoHeight;

				let ratio;
				if (vw !== 0 && vh !== 0) {
					ratio = vh / vw;
				} else {
					ratio = 9 / 16;
				}

				let width = max.w;
				let height = max.w * ratio;
				if (height > max.h) {
					height = max.h;
					width = height / ratio;
				}

				width = Math.floor(width);
				height = Math.floor(height);

				$element.outerWidth(width);
				$element.outerHeight(height);
			}

			$element.on('resize', setSize);
			$scope.$on('$destroy', () => $element.off('resize', setSize));
		}
	};
});

app.controller('ThirdCtrl', function($scope, $window, $log, $timeout, $interval, config, socketService, $anchorScroll, $mdDialog, $location, user) {

	if (!user.userId) {
		$location.path('/');
		return;
	}

	let socket = socketService.connect($scope);
	let userId;
	let localheim;
	let localheimClient;
	let matched = false;

	$scope.languages = [{
		language: 'Hungarian',
		level: 'native'
	}, {
		language: 'English',
		level: 'high'
	}, {
		language: 'German',
		level: 'sucks'
	}];

	//$scope.topics = ['cars', 'food', 'hiking', 'children', 'cars1', 'food1', 'hiking1', 'children1', 'cars2', 'food2', 'hiking2', 'children2', 'cars4', 'food4', 'hiking4', 'children4'];
	$scope.topics = ['cars', 'food'];

	let mouseMoveTimer;
	$scope.mouseMove = () => {
		if (mouseMoveTimer) {
			$timeout.cancel(mouseMoveTimer);
		}
		mouseMoveTimer = $timeout(() => $scope.showControls = false, 3000);
		$scope.showControls = true;
	};

	let rg = new NavigationGuard({
		$scope,
		$mdDialog,
		callback: () => {
			if (matched) {
				return 'You are in a video session.';
			}
		}
	});

	$scope.state = 'queued';

	let channel = {
		send: function(data) {
			socket._socket.emit('ozora', data);
		}
	};
	socket._socket.on('ozora', msg => channel.onMessage(msg));

	let ozora = new Ozora({
		zero: {},
		channel
	});
	let zero = ozora.getObject(0);

	async function ready() {
		await zero.invoke('auth', {userId: user.userId});
		let localStream = await navigator.mediaDevices.getUserMedia({
			audio: true,
			video: true
		});

		$scope.$apply(() => $scope.localStream = localStream);
		localheimClient = new LocalheimClient({zero, stream: $scope.localStream});
		localheimClient.on('match', () => showMatchDialog(localheimClient));
		localheimClient.on('stream', stream => $scope.$apply(() => $scope.remoteStream = stream));
		localheimClient.on('negotiate', () => {
			$scope.$apply(() => $scope.state = 'video');
		});

		await localheimClient.ready();
	}

	ready();

	$scope.signIn = async () => {
		$scope.userId = $scope.userId || '' + Math.random();
		await zero.invoke('auth', {userId: $scope.userId});
	};

	$scope.klose = () => {
		if (localheimClient) {
			localheimClient.reject();
		}
		$location.path('/');
	};

	$scope.toggleFullscreen = () => {
		screenfull.toggle();
	};

	$scope.$on('$destroy', () => screenfull.exit());

	function showMatchDialog(localheimClient) {

		matched = true;
		$scope.state = 'match';

		let partner = localheimClient.members.filter(({self}) => !self)[0];
		$scope.partnerUserId = partner.userId;

		let create = new Date().getTime();
		let iv = $interval(() => {
			let now = new Date().getTime();
			$scope.countdown = Math.max(0, 60000 - (now - create));
		}, 50);
		$scope.countdown = 60000;
		$scope.$on('$destroy', () => {
			$interval.cancel(iv);
		});

		function onNegotiate() { $scope.$apply(() => $scope.negotiated = true); }
		localheimClient.on('negotiate', onNegotiate);
		$scope.$on('$destroy', () => {
			localheimClient.removeListener('negotiate', onNegotiate);
		});

		localheimClient.on('closed', () => {
			//$mdDialog.cancel();
			// TODO: handle
		});

		$scope.accept = () => {
			localheimClient.accept();
			$scope.accepted = true;
		};
		$scope.reject = () => {
			localheimClient.reject();
			//$mdDialog.cancel();
		};

	}

});

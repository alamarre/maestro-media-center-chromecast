window.onload = function () {
	window.mediaElement = document.getElementById('media');
	window.mediaManager = new cast.receiver.MediaManager(window.mediaElement);
	window.castReceiverManager = cast.receiver.CastReceiverManager.getInstance();
	var bus = window.castReceiverManager.getCastMessageBus('urn:x-cast:maestro');
	bus.onMessage = onInitMessage;

	bus = window.castReceiverManager.getCastMessageBus("urn:x-cast:com.google.cast.media");
	bus.onMessage = handleBuiltInMessages;

	window.castReceiverManager.start();

	if(getParameterByName("host")!=null) {
		var id = getParameterByName("id")||"Maestro Auto Chromecast";
		var data = {
                "action": "connect",
                "port": getParameterByName("port")||8080,
                "scheme": getParameterByName("protocol")||"http",
                "guid": id,
                "deviceName": id,
				"serverUrls": [getParameterByName("host")]
		};
		onInitMessage({"data":JSON.stringify(data)});
	}
}

var scheme;
var folder;
var files;
var myName;
var port;
var guid;
var video = document.getElementById("media");
var serverUrl = "";

window.addEventListener("message", function (event) {
	console.log(event);
});

function getParameterByName(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
    return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, " "));
}

function getValidServerUrl(serverUrls, callback) {
	var currentServerUrl = serverUrls[0];
	if(scheme.indexOf(":")==-1) {
		scheme +=":";
	}
	$.ajax({
		url : scheme + "//" + currentServerUrl + ":" + port + "/api/v1.0/health",
		success : function () {
			window.serverUrl = currentServerUrl;
			callback();
		},
		error : function () {
			serverUrls.splice(0, 1);
			if(serverUrls.length==0) return;
			getValidServerUrl(serverUrls, callback);
		}
	});
}

function pauseVideo() {
	video.pause();
	$("#current-episode-info").show();
}

function continueVideo() {
	video.play();
	$("#current-episode-info").show();
	$("#current-episode-info").fadeOut(5000);
}

function handleBuiltInMessages(message) {
	if (message.data.type == "PAUSE") {
		pauseVideo();
	} else if (message.data.type == "PLAY") {
		continueVideo();
	}
}

function onInitMessage(event) {
	var message = JSON.parse(event.data);
	console.log("message in");
	console.log(message);
	console.log(message.action);
	if (message.action == "play") {
		folder = message.folder;

		var playSeasonFunction = function() {
			loadSeason(folder, function (files) {
				window.files = files;
				playVideo(parseInt(message.index));
			});
		};

		if(typeof message.serverUrls == "undefined") {
			playSeasonFunction();
			return;
		}
		myName = message.deviceName;
		port = parseInt(message.port);
		scheme = message.scheme;
		guid = message.guid;
		getValidServerUrl(message.serverUrls, function () {
			setupWebsocket();
			console.log("loading season");
			playSeasonFunction();
		});
	} else if (message.action=="connect") {
		myName = message.deviceName;
		port = parseInt(message.port);
		scheme = message.scheme;
		guid = message.guid;
		getValidServerUrl(message.serverUrls, function () {
			setupWebsocket();
		});
		$("#connected-device").html(myName);
	}
}

function setupWebsocket() {
	var wsPort = parseInt(port) + 1;
	window.ws = new WebSocket("ws://" + serverUrl + ":" + wsPort + "/events");
	ws.onopen = function () {
		ws.send(JSON.stringify({
				"action" : "setId",
				id : guid,
				host : myName
			}));
	};
	ws.onclose = function () {
		setupWebsocket();
	};
	ws.onmessage = function (evt) {
		var received_msg = evt.data;
		var message = JSON.parse(received_msg);
		console.log(message);
		if (message && message.action) {
			switch (message.action) {
			case "playNext":
				playNextVideo();
				break;
			case "playPrevious":
				playPreviousVideo();
				break;
			case "skipForward":
				skipForward();
				break;
			case "skipBack":
				skipBack();
				break;
			case "play":
				if (typeof message.folder != "undefined") {
					onInitMessage({"data":received_msg});
				} else {
					continueVideo();
				}
				break;
			case "pause":
				pauseVideo();
				break;
			case "seek":
				seekPercent(parseInt(message.percent));
				break;
			case "toggleVisibility":
				$("#overlay").toggle();
				break;
			}
		}

	};
}

function skipForward() {
	video.currentTime += 15;
}
function skipBack() {
	video.currentTime -= 15;
}

function seekPercent(percent) {
	var time = video.duration * (percent / 100.0);
	video.currentTime = time;
}

function playVideo(index) {
	$(video).empty();
	$("#splash-screen").hide();
	window.index = index;
	if (index >= window.files.length) {
		playNextSeason();
		return;
	}
	$(video).attr("crossorigin", "anonymous");
	var src = "/videos";
	src += folder + "/" + window.files[index];
	src = scheme + "//" + serverUrl + ":" + port + src;

	var source = document.createElement("source");
	$(source).attr("type", "video/mp4");
	$(source).attr("src", src);
	$(video).append(source);

	var track = document.createElement("track");
	$(track).attr("kind", "subtitles");
	$(track).attr("label", "English");
	$(track).attr("srclang", "en");
	$(track).attr("default", true);
	$(track).attr("src", src.replace(".mp4", ".vtt"));
	$(video).append(track);

	video.load();
	$("#current-episode-info").html(window.files[index]);
	continueVideo();
}

function playNextSeason() {
	getNextSeason(function (season) {
		loadSeason(season, function (files) {
			folder = season;
			window.files = files;
			playVideo(0);
		})
	});
}

function getShortFolderName(folder) {
	var parentFolder = getParentFolder(folder);
	var shortFolderName = folder.substring(parentFolder.length + 1);
	return shortFolderName;
}

function getParentFolder(folder) {
	var parentFolder = folder.substring(0, folder.lastIndexOf("/"));
	return parentFolder;
}

function getPreviousSeason(callback) {
	var parentFolder = getParentFolder(folder);
	var shortFolderName = getShortFolderName(folder);

	getFolderListing(parentFolder, function (result) {
		//start late in case it is the first season
		for (var i = 1; i < result.folders.length; i++) {
			if (result.folders[i] == shortFolderName) {
				callback(parentFolder + "/" + result.folders[i - 1]);
				return;
			}
		}
	});
}

function getNextSeason(callback) {
	var parentFolder = getParentFolder(folder);
	var shortFolderName = getShortFolderName(folder);
	getFolderListing(parentFolder, function (result) {
		//stop early in case this is the last season
		for (var i = 0; i < result.folders.length - 1; i++) {
			if (result.folders[i] == shortFolderName) {
				callback(parentFolder + "/" + result.folders[i + 1]);
				return;
			}
		}
	});
}

function playNextVideo() {
	playVideo(window.index + 1);
}
function playPreviousVideo() {
	playVideo(window.index - 1);
}

function getFolderListing(folder, callback) {
	$.ajax({
		url : scheme + "//" + serverUrl + ":" + port + "/api/v1.0/folders",
		type : 'GET',
		data : {
			path : folder
		},
		success : function (response) {
			console.log(response);
			response.files = response.files.filter(function(file) {
            	return file.indexOf(".mp4") == (file.length-".mp4".length);
        	});
			callback(response);
		},
		error : function (err) {
			console.log(err);
		}
	});
}

function loadSeason(folder, callback) {
	$.ajax({
		url : scheme + "//" + serverUrl + ":" + port + "/api/v1.0/folders",
		type : 'GET',
		data : {
			path : folder
		},
		success : function (response) {
			console.log(response);
			response.files = response.files.filter(function(file) {
            	return file.indexOf(".mp4") == (file.length-".mp4".length);
        	});
			callback(response.files);
		},
		error : function (err) {
			console.log(err);
		}
	});
}

$(video).bind('ended', function () {
	playNextVideo();
});

var xmlhttp = false;
var total_unread = 0;
var first_run = true;
var display_tags = false;
var global_unread = -1;
var active_title_text = "";
var current_subtitle = "";
var daemon_enabled = false;
var _qfd_deleted_feed = 0;
var firsttime_update = true;
var last_refetch = 0;
var cookie_lifetime = 0;
var active_feed_id = 0;

var xmlhttp = Ajax.getTransport();

var init_params = new Array();

function toggleTags() {
	display_tags = !display_tags;

	var p = document.getElementById("dispSwitchPrompt");

	if (display_tags) {
		p.innerHTML = "display feeds";
	} else {
		p.innerHTML = "display tags";
	}
	
	updateFeedList();
}

function dlg_frefresh_callback() {
	if (xmlhttp.readyState == 4) {
		notify(xmlhttp.responseText);
		updateFeedList(false, false);
		if (_qfd_deleted_feed) {
			var hframe = document.getElementById("headlines-frame");
			if (hframe) {
				hframe.src = "backend.php?op=error&msg=No%20feed%20selected.";
			}
		}
		closeInfoBox();
	} 
}

function refetch_callback() {
	if (xmlhttp.readyState == 4) {
		try {

			var date = new Date();

			last_refetch = date.getTime() / 1000;

			if (!xmlhttp.responseXML) {
				notify("refetch_callback: backend did not return valid XML", true, true);
				return;
			}
		
			var reply = xmlhttp.responseXML.firstChild;
	
			if (!reply) {
				notify("refetch_callback: backend did not return expected XML object", true, true);
				updateTitle("");
				return;
			} 
	
			var error_code = reply.getAttribute("error-code");
		
			if (error_code && error_code != 0) {
				return fatalError(error_code, reply.getAttribute("error-msg"));
			}
	
			parse_counters(reply, true);

			debug("refetch_callback: done");

			if (!daemon_enabled) {
				notify("All feeds updated.");
				updateTitle("");
			} else {
				notify("");
			}
		} catch (e) {
			exception_error("refetch_callback", e);
			updateTitle("");
		}
	}
}

function backend_sanity_check_callback() {

	if (xmlhttp.readyState == 4) {

		try {
		
			if (!xmlhttp.responseXML) {
				fatalError(3, "[D001, Received reply is not XML]: " + xmlhttp.responseText);
				return;
			}
	
			var reply = xmlhttp.responseXML.firstChild.firstChild;
	
			if (!reply) {
				fatalError(3, "[D002, Invalid RPC reply]: " + xmlhttp.responseText);
				return;
			}
	
			var error_code = reply.getAttribute("error-code");
		
			if (error_code && error_code != 0) {
				return fatalError(error_code, reply.getAttribute("error-msg"));
			}
	
			debug("sanity check ok");

			var params = reply.nextSibling;

			if (params) {
				debug('reading init-params...');
				var param = params.firstChild;

				while (param) {
					var k = param.getAttribute("key");
					var v = param.getAttribute("value");
					debug(k + " => " + v);
					init_params[k] = v;					
					param = param.nextSibling;
				}
			}

			init_second_stage();

		} catch (e) {
			exception_error("backend_sanity_check_callback", e);
		}
	} 
}

function scheduleFeedUpdate(force) {

	if (!daemon_enabled) {
		notify("Updating feeds, please wait.", true);
		updateTitle("Updating");
	}

	var query_str = "backend.php?op=rpc&subop=";

	if (force) {
		query_str = query_str + "forceUpdateAllFeeds";
	} else {
		query_str = query_str + "updateAllFeeds";
	}

	var omode;

	if (firsttime_update && !navigator.userAgent.match("Opera")) {
		firsttime_update = false;
		omode = "T";
	} else {
		if (display_tags) {
			omode = "t";
		} else {
			omode = "flc";
		}
	}
	
	query_str = query_str + "&omode=" + omode;
	query_str = query_str + "&uctr=" + global_unread;

	debug("in scheduleFeedUpdate");

	var date = new Date();

	if (!xmlhttp_ready(xmlhttp) && last_refetch < date.getTime() / 1000 - 60) {
		debug("xmlhttp seems to be stuck, aborting");
		xmlhttp.abort();
	}

	if (xmlhttp_ready(xmlhttp)) {
		xmlhttp.open("GET", query_str, true);
		xmlhttp.onreadystatechange=refetch_callback;
		xmlhttp.send(null);
	} else {
		debug("xmlhttp busy");
		printLockingError();
	}   
}

function updateFeedList(silent, fetch) {

//	if (silent != true) {
//		notify("Loading feed list...");
//	}

	var query_str = "backend.php?op=feeds";

	if (display_tags) {
		query_str = query_str + "&tags=1";
	}

	if (getActiveFeedId()) {
		query_str = query_str + "&actid=" + getActiveFeedId();
	}

	if (navigator.userAgent.match("Opera")) {
		var date = new Date();
		var timestamp = Math.round(date.getTime() / 1000);
		query_str = query_str + "&ts=" + timestamp
	}
	
	if (fetch) query_str = query_str + "&fetch=yes";

	var feeds_frame = document.getElementById("feeds-frame");

	feeds_frame.src = query_str;
}

function catchupAllFeeds() {

	var query_str = "backend.php?op=feeds&subop=catchupAll";

	notify("Marking all feeds as read...");

	var feeds_frame = document.getElementById("feeds-frame");

	feeds_frame.src = query_str;

	global_unread = 0;
	updateTitle("");

}

function viewCurrentFeed(skip, subop) {

	if (getActiveFeedId()) {
		viewfeed(getActiveFeedId(), skip, subop);
	} else {
		disableContainerChildren("headlinesToolbar", false, document);
		viewfeed(-1, skip, subop); // FIXME
	}
	return false; // block unneeded form submits
}

function viewfeed(feed, skip, subop) {
	var f = window.frames["feeds-frame"];
	f.viewfeed(feed, skip, subop);
}

function timeout() {
	scheduleFeedUpdate(false);

	var refresh_time = getInitParam("feeds_frame_refresh");

	if (!refresh_time) refresh_time = 600; 

	setTimeout("timeout()", refresh_time*1000);
}

function resetSearch() {
	var searchbox = document.getElementById("searchbox")

	if (searchbox.value != "" && getActiveFeedId()) {	
		searchbox.value = "";
		viewfeed(getActiveFeedId(), 0, "");
	}
}

function searchCancel() {
	closeInfoBox(true);
}

function search() {
	closeInfoBox();	
	viewCurrentFeed(0, "");
}

function localPiggieFunction(enable) {
	if (enable) {
		var query_str = "backend.php?op=feeds&subop=piggie";

		if (xmlhttp_ready(xmlhttp)) {

			xmlhttp.open("GET", query_str, true);
			xmlhttp.onreadystatechange=feedlist_callback;
			xmlhttp.send(null);
		}
	}
}

function localHotkeyHandler(keycode) {

	if (keycode == 82) { // r
		return scheduleFeedUpdate(true);
	}

	if (keycode == 85) { // u
		if (getActiveFeedId()) {
			return viewfeed(getActiveFeedId(), 0, "ForceUpdate");
		}
	}

	if (keycode == 65) { // a
		return toggleDispRead();
	}

	var f_doc = window.frames["feeds-frame"].document;
	var feedlist = f_doc.getElementById('feedList');

	if (keycode == 74) { // j
		var feed = getActiveFeedId();
		var new_feed = getRelativeFeedId(feedlist, feed, 'prev');
		if (new_feed) viewfeed(new_feed, 0, '');
	}

	if (keycode == 75) { // k
		var feed = getActiveFeedId();
		var new_feed = getRelativeFeedId(feedlist, feed, 'next');
		if (new_feed) viewfeed(new_feed, 0, '');
	}

//	notify("KC: " + keycode);

}

// if argument is undefined, current subtitle is not updated
// use blank string to clear subtitle
function updateTitle(s) {
	var tmp = "Tiny Tiny RSS";

	if (s != undefined) {
		current_subtitle = s;
	}

	if (global_unread > 0) {
		tmp = tmp + " (" + global_unread + ")";
	}

	if (current_subtitle) {
		tmp = tmp + " - " + current_subtitle;
	}

	if (active_title_text.length > 0) {
		tmp = tmp + " > " + active_title_text;
	}

	document.title = tmp;
}

function genericSanityCheck() {

	if (!xmlhttp) fatalError(1);

	setCookie("ttrss_vf_test", "TEST");
	
	if (getCookie("ttrss_vf_test") != "TEST") {
		fatalError(2);
	}

	return true;
}

function init() {

	try {

		// this whole shebang is based on http://www.birnamdesigns.com/misc/busted2.html

		if (arguments.callee.done) return;
		arguments.callee.done = true;		

		disableContainerChildren("headlinesToolbar", true);

		Form.disable("main_toolbar_form");

		if (!genericSanityCheck()) 
			return;

		if (getURLParam('debug')) {
			document.getElementById('debug_output').style.display = 'block';
			debug('debug mode activated');
		}

		xmlhttp.open("GET", "backend.php?op=rpc&subop=sanityCheck", true);
		xmlhttp.onreadystatechange=backend_sanity_check_callback;
		xmlhttp.send(null);

	} catch (e) {
		exception_error("init", e);
	}
}

function resize_feeds_frame() {
	var f = document.getElementById("feeds-frame");
	var tf = document.getElementById("mainFooter");
	var th = document.getElementById("mainHeader");
		 
	f.style.height = document.body.scrollHeight - tf.scrollHeight - 
		th.scrollHeight - 50 + "px";
}

function init_second_stage() {

	try {

		cookie_lifetime = getCookie("ttrss_cltime");

		delCookie("ttrss_vf_test");
	
		updateFeedList(false, false);
		document.onkeydown = hotkey_handler;

		var tb = parent.document.forms["main_toolbar_form"];

		dropboxSelect(tb.view_mode, getInitParam("toolbar_view_mode"));
		dropboxSelect(tb.limit, getInitParam("toolbar_limit"));

		daemon_enabled = getInitParam("daemon_enabled");

		// FIXME should be callled after window resize

		var h = document.getElementById("headlines");
		var c = document.getElementById("content");

		if (navigator.userAgent.match("Opera")) {
			resize_feeds_frame();

/*			// fix headlines frame height for Opera
			var h = document.getElementById("headlines");
			var c = document.getElementById("content");
			var nh = document.body.scrollHeight * 0.25;
	
			h.style.height = nh + "px";
			c.style.height = c.scrollHeight - nh + "px"; */
			
		}

		debug("second stage ok");
	
	} catch (e) {
		exception_error("init_second_stage", e);
	}
}

function quickMenuChange() {
	var chooser = document.getElementById("quickMenuChooser");
	var opid = chooser[chooser.selectedIndex].value;

	chooser.selectedIndex = 0;
	quickMenuGo(opid);
}

function quickMenuGo(opid) {
	try {

		if (opid == "qmcPrefs") {
			gotoPreferences();
		}
	
		if (opid == "qmcSearch") {
			displayDlg("search", getActiveFeedId());
			return;
		}
	
		if (opid == "qmcAddFeed") {
			displayDlg("quickAddFeed");
			return;
		}
	
		if (opid == "qmcRemoveFeed") {
			var actid = getActiveFeedId();
	
			if (!actid) {
				alert("Please select some feed first.");
				return;
			}
	
			if (confirm("Unsubscribe from current feed?")) {
				qfdDelete(actid);
			}
		
			return;
		}
	
		if (opid == "qmcUpdateFeeds") {
			scheduleFeedUpdate(true);
			return;
		}
	
		if (opid == "qmcCatchupAll") {
			catchupAllFeeds();
			return;
		}
	
		if (opid == "qmcShowOnlyUnread") {
			toggleDispRead();
			return;
		}
	
		if (opid == "qmcAddFilter") {
			displayDlg("quickAddFilter", getActiveFeedId());
		}
	} catch (e) {
		exception_error("quickMenuGo", e);
	}
}

function qfdDelete(feed_id) {

	notify("Removing feed...");

	if (!xmlhttp_ready(xmlhttp)) {
		printLockingError();
		return
	}

//	var feeds_doc = window.frames["feeds-frame"].document;
//	feeds_doc.location.href = "backend.php?op=error&msg=Loading,%20please wait...";

	_qfd_deleted_feed = feed_id;

	xmlhttp.open("GET", "backend.php?op=pref-feeds&quiet=1&subop=remove&ids=" + feed_id);
	xmlhttp.onreadystatechange=dlg_frefresh_callback;
	xmlhttp.send(null);
}


function updateFeedTitle(t) {
	active_title_text = t;
	updateTitle();
}

function toggleDispRead() {
	try {

		if (!xmlhttp_ready(xmlhttp)) {
			printLockingError();
			return
		}

		var hide_read_feeds = (getInitParam("hide_read_feeds") == "1");

		hide_read_feeds = !hide_read_feeds;

		debug("toggle_disp_read => " + hide_read_feeds);

		hideOrShowFeeds(getFeedsContext().document, hide_read_feeds);

		var query = "backend.php?op=rpc&subop=setpref" +
			"&key=HIDE_READ_FEEDS&value=" + param_escape(hide_read_feeds);

		storeInitParam("hide_read_feeds", hide_read_feeds, true);

		new Ajax.Request(query);
		
	} catch (e) {
		exception_error("toggleDispRead", e);
	}
}

function fatalError(code, message) {
	try {	
		var fe = document.getElementById("fatal_error");
		var fc = document.getElementById("fatal_error_msg");

		fc.innerHTML = "Code " + code + ": " + message;

		fe.style.display = "block";

	} catch (e) {
		exception_error("fatalError", e);
	}
}



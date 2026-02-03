/**
 * panel - today-warning
 *
 * 오늘의 날씨 특보(기상특보/예비특보)
 */
'use strict';
(function($, window, document){
	var VER="20191205-1",
	WeatherWarning = function(wrapperId, viewType) {
		if(typeof jQuery === 'undefined') {
			alert('jQuery required!');
		}
		if(typeof store === 'undefined') {
			alert('store.js required!');
		}
		if(typeof Mustache === 'undefined') {
			alert('mustache.js required!');
		}
		var self = this;
		self.id = wrapperId;
		self.viewType = viewType?viewType:"";
		self.state = {};
		self.config = {};
		self.updateData();
		self.addEventHandler();
	};
	WeatherWarning.prototype = {
		refresh: function() {
			var self = this;
			self.updateData();
		},
		updateData: function() {
			var self = this;
			if(!self.viewType != "main") showLoading(self.id, true, "light");
			self.requestRemote()
			.then(
				function(data) {
					self.updateView(data);
					if(!self.viewType != "main")showLoading(self.id, false);
				},
				self.error()
			)	
		},
		getData: function() {
			var self = this;
			var pathPrefix = self.getPathPrefix();
			var data = {
				
			};
			var url = "";
			if(self.viewType == "main") {
				url = pathPrefix + "wnuri-fct2021/main/warning.do"
			} else {
				url = pathPrefix + "wnuri-fct2021/weather/warning.do"
			}
			return $.ajax({
				url: url,
				data: data,
				dataType: "html"
			});
		},
		getPathPrefix: function() {
			if(window.appBase) {
				return window.appBase;
			} else {
				return "/";
			}
		},
		requestRemote: function(code, unit) {
			var self = this;
			return self.getData(code, unit);	
		},
		updateView: function(html) {
			var self = this;
			
			var $wrapper = $('#' + self.id);
			$wrapper.html(html);
			
			weatherUI.tab('.weather-cmt-tab','.weather-cmt-content','.scroll-js5');
			GlobalEvent.trigger($.Event("onWeatherWarningLoad"), [self]);
			function closeBox() {
				createDimm().fadeOut(200, function() {
					$(this).remove();
				});
				var $moreBtn = $('a[data-event=on-more-click]');
				$moreBtn.show().prev().removeClass('more');
			}
			
			function createEvents() {
				$('a[data-event=on-more-click]').on('click', function(e) {
					e.preventDefault();
					$(this).hide();
					createDimm().fadeIn(200).on('click', function(e) { closeBox(); });
					var $box = $(this).prev();
					if(!$box.hasClass('more')) $box.addClass('more');
				});
				
				$('.cmp-weather-cmt-txt-box-close').on('click', function(e) { e.preventDefault(); closeBox(); });	
			}
			function createDimm() {
				var $dim = $('.pw-dimmed'); 
				if($dim.length == 0) {
					$dim = $('<div class="pw-dimmed" aria-hidden="true"></div>').appendTo($('body'));	
				}
				return $dim;
			}
			function removeDimm() {
				$(".pw-dimmed").remove();
			}
			createEvents();
		},
		error: function() {
			var self = this;
			return function(request, status) {
				if(console) console.log(request, status);
				showLoading(self.id, false);
			};
		},
		addEventHandler: function() {
			var self = this;
			// save, cancel
			var $wrapper = $('#' + self.id);
			
		}
	};
	
	if (typeof exports !== 'undefined') exports.WeatherWarning = WeatherWarning;
	else window.WeatherWarning = WeatherWarning;
})(jQuery, window, document);